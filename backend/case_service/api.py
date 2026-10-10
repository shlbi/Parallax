import hmac
import secrets
import time
from contextlib import asynccontextmanager
from typing import Annotated
from fastapi import Depends, FastAPI, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import delete, insert, select
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.trustedhost import TrustedHostMiddleware
from .config import Settings
from .database import Database, sessions, users
from .schemas import CaseCreate, CasePatch, GrantInput, Login, MemberInput, RevokeInput
from .security import (DUMMY_PASSWORD, Problem, authenticate, check_password, csrf_token,
                       rate_attempt, token_digest)
from .service import CaseService


class RequestBoundary:
    """No CORS. Exact Origin + JSON + CSRF on mutations, bounded streamed request bodies."""
    def __init__(self, app, settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode("latin-1") for k, v in scope["headers"]}
        settings = self.settings

        async def safe_send(message):
            if message["type"] == "http.response.start":
                message["headers"] = [(k, v) for k, v in message.get("headers", [])
                                      if k.lower() != b"cache-control"] + [
                    (b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer")]
            await send(message)

        async def reject(status, code, message):
            await JSONResponse({"error": {"code": code, "message": message}}, status_code=status)(scope, receive, safe_send)

        if scope["path"] != "/healthz" and settings.gateway_secret and not hmac.compare_digest(
                headers.get("x-parallax-gateway", "").encode(), settings.gateway_secret.encode()):
            return await reject(403, "GATEWAY_REQUIRED", "Use the configured application gateway.")
        if scope["method"] not in {"GET", "HEAD", "OPTIONS"}:
            if headers.get("origin") != settings.public_origin:
                return await reject(403, "ORIGIN_REJECTED", "Request origin is not permitted.")
            if headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
                return await reject(415, "JSON_REQUIRED", "Use an application/json request.")
            body = bytearray()
            while True:
                event = await receive()
                if event["type"] == "http.disconnect":
                    return
                body.extend(event.get("body", b""))
                if len(body) > settings.max_body_bytes:
                    return await reject(413, "BODY_TOO_LARGE", "Request exceeds 32 KiB.")
                if not event.get("more_body"):
                    break

            async def replay():
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            receive = replay
        await self.app(scope, receive, safe_send)


def create_app(settings: Settings | None = None, *, clock=time.time) -> FastAPI:
    settings = settings or Settings.from_env()
    database = Database(settings.database_url)
    service = CaseService(database, clock)

    @asynccontextmanager
    async def lifespan(_):
        database.check_schema()
        yield
        database.close()

    app = FastAPI(title="PARALLAX case foundation", version="0.5.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)
    app.state.database, app.state.service, app.state.settings = database, service, settings
    app.add_middleware(RequestBoundary, settings=settings)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))

    @app.exception_handler(Problem)
    async def problem_handler(_, exc):
        return JSONResponse({"error": {"code": exc.code, "message": exc.message}}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(_, exc):
        # Pydantic error objects include submitted inputs; never echo them (notably passwords).
        return JSONResponse({"error": {"code": "INVALID_REQUEST", "message": "Check the request fields."}}, status_code=422)

    @app.exception_handler(SQLAlchemyError)
    async def storage_handler(_, exc):
        # SQL exceptions may contain bound parameters: do not echo or log them.
        return JSONResponse({"error": {"code": "STORAGE_UNAVAILABLE", "message": "Case storage is unavailable. Try again later."}}, status_code=503)

    def operator(request: Request):
        token = request.cookies.get(settings.cookie_name, "")
        return authenticate(database, settings, token, request.headers.get("x-parallax-csrf", ""),
                            request.method not in {"GET", "HEAD", "OPTIONS"}, clock())

    Actor = Annotated[dict, Depends(operator)]

    def version(if_match: Annotated[str | None, Header()] = None):
        import re
        if if_match is None:
            raise Problem(428, "VERSION_REQUIRED", "Supply the case version in If-Match.")
        if not re.fullmatch(r'(?:[1-9][0-9]{0,9}|"[1-9][0-9]{0,9}")', if_match):
            raise Problem(422, "INVALID_VERSION", "Invalid case version.")
        return int(if_match.strip('"'))

    Version = Annotated[int, Depends(version)]

    @app.get("/healthz")
    def health():
        return {"status": "ok", "service": "case-foundation", "schema_version": 1}

    @app.post("/v1/session")
    def login(data: Login, request: Request, response: Response):
        now, username = clock(), data.username.lower()
        rate_attempt(database, "global", 120, 60, now)
        rate_attempt(database, "account:" + token_digest(username), 10, 900, now)
        with database.transaction() as db:
            user = db.execute(select(users).where(users.c.username == username)).mappings().first()
        valid = check_password(data.password, user["password_hash"] if user else DUMMY_PASSWORD)
        if not valid or not user or user["disabled"]:
            raise Problem(401, "LOGIN_FAILED", "Invalid username or password.")
        token = secrets.token_urlsafe(32)
        with database.transaction() as db:
            # Reject a concurrently disabled account or changed password.
            current = db.execute(select(users).where(users.c.id == user["id"]).with_for_update()).mappings().one()
            if current["disabled"] or current["password_hash"] != user["password_hash"]:
                raise Problem(401, "LOGIN_FAILED", "Invalid username or password.")
            db.execute(delete(sessions).where(sessions.c.expires_at <= now))
            old = request.cookies.get(settings.cookie_name, "")
            if old:
                db.execute(delete(sessions).where(sessions.c.digest == token_digest(old)))
            db.execute(insert(sessions).values(digest=token_digest(token), user_id=user["id"],
                       expires_at=now + settings.session_seconds, last_seen=now))
        response.set_cookie(settings.cookie_name, token, httponly=True, secure=settings.secure_cookie,
                            samesite="strict", path="/", max_age=settings.session_seconds)
        return {"user": {"id": user["id"], "username": username}, "csrf_token": csrf_token(token)}

    @app.get("/v1/session")
    def session(request: Request, actor: Actor):
        return {"user": actor, "csrf_token": csrf_token(request.cookies[settings.cookie_name])}

    @app.delete("/v1/session", status_code=204)
    def logout(request: Request, response: Response, actor: Actor):
        with database.transaction() as db:
            db.execute(delete(sessions).where(sessions.c.digest == token_digest(request.cookies[settings.cookie_name])))
        response.delete_cookie(settings.cookie_name, path="/", secure=settings.secure_cookie, httponly=True, samesite="strict")

    @app.post("/v1/session/revoke-all", status_code=204)
    def logout_all(response: Response, actor: Actor):
        with database.transaction() as db:
            db.execute(delete(sessions).where(sessions.c.user_id == actor["id"]))
        response.delete_cookie(settings.cookie_name, path="/", secure=settings.secure_cookie, httponly=True, samesite="strict")

    @app.get("/v1/cases")
    def list_cases(actor: Actor, offset: int = Query(0, ge=0, le=100000), limit: int = Query(40, ge=1, le=100)):
        return service.list_cases(actor["id"], offset, limit)

    @app.post("/v1/cases", status_code=201)
    def create_case(data: CaseCreate, actor: Actor):
        return service.create(actor["id"], data.model_dump())

    @app.get("/v1/cases/{case_id}")
    def get_case(case_id: str, response: Response, actor: Actor):
        value = service.get(case_id, actor["id"])
        response.headers["ETag"] = f'"{value["version"]}"'
        return value

    @app.patch("/v1/cases/{case_id}")
    def patch_case(case_id: str, data: CasePatch, actor: Actor, expected: Version):
        # Explicit null is rejected instead of silently clearing required fields.
        fields = data.model_dump(exclude_unset=True)
        if any(v is None for v in fields.values()):
            raise Problem(422, "INVALID_REQUEST", "Case fields cannot be null.")
        return service.patch(case_id, actor["id"], expected, fields)

    @app.delete("/v1/cases/{case_id}", status_code=204)
    def delete_case(case_id: str, actor: Actor, expected: Version):
        service.delete(case_id, actor["id"], expected)

    @app.get("/v1/cases/{case_id}/members")
    def list_members(case_id: str, actor: Actor):
        return {"items": service.membership_list(case_id, actor["id"])}

    @app.put("/v1/cases/{case_id}/members")
    def set_member(case_id: str, data: MemberInput, actor: Actor, expected: Version):
        return service.set_member(case_id, actor["id"], expected, data.username, data.role)

    @app.delete("/v1/cases/{case_id}/members/{user_id}")
    def remove_member(case_id: str, user_id: str, actor: Actor, expected: Version):
        return service.remove_member(case_id, actor["id"], expected, user_id)

    @app.get("/v1/cases/{case_id}/authorizations")
    def list_grants(case_id: str, actor: Actor):
        return {"items": service.grant_list(case_id, actor["id"])}

    @app.post("/v1/cases/{case_id}/authorizations", status_code=201)
    def add_grant(case_id: str, data: GrantInput, actor: Actor, expected: Version):
        return service.add_grant(case_id, actor["id"], expected, data.model_dump())

    @app.post("/v1/cases/{case_id}/authorizations/{grant_id}/revoke")
    def revoke_grant(case_id: str, grant_id: str, data: RevokeInput, actor: Actor, expected: Version):
        return service.revoke(case_id, actor["id"], expected, grant_id, data.reason)

    @app.get("/v1/cases/{case_id}/audit")
    def case_audit(case_id: str, actor: Actor, after: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
        return service.audit_list(case_id, actor["id"], after, limit)

    return app
