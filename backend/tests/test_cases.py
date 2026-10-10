import concurrent.futures
from datetime import datetime, timezone
import json
from sqlalchemy import func, insert, select, update
import pytest
from fastapi.testclient import TestClient
from backend.case_service.api import create_app
from backend.case_service.database import audit, cases, grants, members, sessions, users
from backend.case_service.security import Problem, token_digest
from .conftest import NOW, ORIGIN, PASSWORD


def make(c, kind="participant"):
    r = c.post("/v1/cases", json={"title": "Case A", "description": "Owner-supplied notes", "kind": kind})
    assert r.status_code == 201, r.text
    return r.json()


def headers(c, cid):
    r = c.get(f"/v1/cases/{cid}")
    assert r.status_code == 200
    return {"If-Match": r.headers["ETag"]}


def share(owner, cid, username, role):
    r = owner.put(f"/v1/cases/{cid}/members", headers=headers(owner, cid), json={"username": username, "role": role})
    assert r.status_code == 200, r.text
    return r.json()


def grant(c, cid, **overrides):
    data = {"participant_reference": "Participant P-1", "purpose": "Review supplied research materials",
            "source_scope": ["participant-supplied-records"], "actions": ["case_records", "document_analysis"],
            "signed_on": "2026-10-01", "expires_at": None, **overrides}
    return c.post(f"/v1/cases/{cid}/authorizations", headers=headers(c, cid), json=data)


@pytest.mark.parametrize("path", ["/v1/session", "/v1/cases", "/v1/cases/missing", "/v1/cases/missing/members", "/v1/cases/missing/authorizations", "/v1/cases/missing/audit"])
def test_anonymous_denied(env, path):
    assert env["client"]().get(path).status_code == 401


def test_session_cookie_digest_csrf_logout(env):
    c = env["client"]()
    r = c.post("/v1/session", json={"username": "owner", "password": PASSWORD})
    assert r.status_code == 200
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie and "Path=/" in cookie
    assert "Domain=" not in cookie and "Secure" not in cookie
    raw = c.cookies["parallax_session"]
    with env["database"].transaction() as db:
        row = db.execute(select(sessions)).mappings().one()
        assert row["digest"] == token_digest(raw) and raw not in str(row)
        row = db.execute(select(users).where(users.c.username == "owner")).mappings().one()
        assert PASSWORD not in row["password_hash"]
    assert c.post("/v1/cases", json={"title": "blocked"}).status_code == 403
    c.headers["X-Parallax-CSRF"] = r.json()["csrf_token"]
    assert c.get("/v1/session").json()["csrf_token"] == r.json()["csrf_token"]
    assert c.request("DELETE", "/v1/session", json={}).status_code == 204
    c.cookies.set("parallax_session", raw)
    assert c.get("/v1/session").status_code == 401


def test_session_rotation_and_logout_all(env):
    c = env["client"]("owner")
    old = c.cookies["parallax_session"]
    response = c.post("/v1/session", json={"username": "owner", "password": PASSWORD})
    assert response.status_code == 200 and c.cookies["parallax_session"] != old
    c.headers["X-Parallax-CSRF"] = response.json()["csrf_token"]
    other = env["client"]("owner")
    stale = env["client"]()
    stale.cookies.set("parallax_session", old)
    assert stale.get("/v1/session").status_code == 401
    assert c.post("/v1/session/revoke-all", json={}).status_code == 204
    assert other.get("/v1/session").status_code == 401


@pytest.mark.parametrize("change", ["idle", "absolute", "disabled"])
def test_session_expiry_and_disabled_account(env, change):
    c = env["client"]("owner")
    if change == "disabled":
        with env["database"].transaction() as db:
            db.execute(update(users).where(users.c.username == "owner").values(disabled=True))
    elif change == "idle":
        env["now"][0] += env["settings"].idle_seconds
    else:
        with env["database"].transaction() as db:
            db.execute(update(sessions).values(expires_at=NOW))
    assert c.get("/v1/session").status_code == 401


@pytest.mark.parametrize("name", ["owner", "unknown"])
def test_bad_login_is_generic_and_rate_limited(env, name):
    c = env["client"]()
    for _ in range(10):
        r = c.post("/v1/session", json={"username": name, "password": "incorrect-password"})
        assert r.status_code == 401 and r.json()["error"]["code"] == "LOGIN_FAILED"
    assert c.post("/v1/session", json={"username": name, "password": PASSWORD}).status_code == 429


@pytest.mark.parametrize("request_headers,status", [({"Origin": "https://attacker.example"}, 403), ({"Origin": "null"}, 403), ({"Content-Type": "text/plain"}, 415), ({"Host": "attacker.example"}, 400)])
def test_origin_host_content_type(env, request_headers, status):
    c = env["client"]()
    r = c.post("/v1/session", headers=request_headers, content=json.dumps({"username": "owner", "password": PASSWORD}))
    assert r.status_code == status


def test_missing_origin_rejected(env):
    c = env["client"]()
    del c.headers["Origin"]
    assert c.post("/v1/session", json={"username": "owner", "password": PASSWORD}).status_code == 403


def test_validation_and_oversize_do_not_echo_secrets(env):
    c = env["client"]()
    r = c.post("/v1/session", json={"username": "owner", "password": PASSWORD, "admin": True})
    assert r.status_code == 422 and PASSWORD not in r.text and "admin" not in r.text
    r = c.post("/v1/session", content=b"x" * 33000)
    assert r.status_code == 413
    assert r.headers["cache-control"] == "no-store"


def test_persist_restart_and_pagination(env):
    c = env["client"]("owner")
    created = [make(c) for _ in range(3)]
    other_app = create_app(env["settings"], clock=lambda: env["now"][0])
    with TestClient(other_app) as other:
        other.cookies.update(c.cookies)
        assert other.get("/v1/cases/" + created[0]["id"]).status_code == 200
        page = other.get("/v1/cases?limit=2").json()
        assert len(page["items"]) == 2 and page["next_offset"] == 2
        last = other.get("/v1/cases?offset=2&limit=2").json()
        assert len(last["items"]) == 1 and last["next_offset"] is None
        assert {x["id"] for x in page["items"] + last["items"]} == {x["id"] for x in created}


@pytest.mark.parametrize("suffix", ["", "/members", "/authorizations", "/audit"])
def test_cross_account_read_isolation(env, suffix):
    a, b = env["client"]("owner"), env["client"]("outsider")
    cid = make(a)["id"]
    assert b.get(f"/v1/cases/{cid}{suffix}").status_code == 404
    assert b.get("/v1/cases").json()["items"] == []


@pytest.mark.parametrize("method,suffix,body", [
    ("PATCH", "", {"title": "stolen"}), ("DELETE", "", {}),
    ("PUT", "/members", {"username": "outsider", "role": "editor"}),
    ("POST", "/authorizations", {"participant_reference": "P", "purpose": "test", "source_scope": ["x"], "actions": ["case_records"]}),
    ("DELETE", "/members/000", {}), ("POST", "/authorizations/000/revoke", {"reason": "test"})])
def test_cross_account_write_isolation(env, method, suffix, body):
    a, b = env["client"]("owner"), env["client"]("outsider")
    cid = make(a)["id"]
    assert b.request(method, f"/v1/cases/{cid}{suffix}", headers={"If-Match": "1"}, json=body).status_code == 404


def test_role_permissions_and_immediate_removal(env):
    a, e, v = (env["client"](n) for n in ("owner", "editor", "viewer"))
    cid = make(a)["id"]
    share(a, cid, "editor", "editor")
    share(a, cid, "viewer", "viewer")
    assert v.get(f"/v1/cases/{cid}").status_code == 200
    assert v.patch(f"/v1/cases/{cid}", headers=headers(v, cid), json={"title": "no"}).status_code == 403
    assert e.patch(f"/v1/cases/{cid}", headers=headers(e, cid), json={"title": "Edited"}).status_code == 200
    assert e.patch(f"/v1/cases/{cid}", headers=headers(e, cid), json={"state": "archived"}).status_code == 403
    assert e.put(f"/v1/cases/{cid}/members", headers=headers(e, cid), json={"username": "outsider", "role": "editor"}).status_code == 403
    assert grant(e, cid).status_code == 403
    assert v.get(f"/v1/cases/{cid}/members").status_code == 403
    r = a.request("DELETE", f"/v1/cases/{cid}/members/{env['ids']['editor']}", headers=headers(a, cid), json={})
    assert r.status_code == 200
    assert e.get(f"/v1/cases/{cid}").status_code == 404


def test_owner_immutable_and_no_admin_escalation(env):
    a = env["client"]("owner")
    cid = make(a)["id"]
    assert a.put(f"/v1/cases/{cid}/members", headers=headers(a, cid), json={"username": "owner", "role": "viewer"}).status_code == 409
    assert a.put(f"/v1/cases/{cid}/members", headers=headers(a, cid), json={"username": "outsider", "role": "owner"}).status_code == 422
    assert a.request("DELETE", f"/v1/cases/{cid}/members/{env['ids']['owner']}", headers=headers(a, cid), json={}).status_code == 409


@pytest.mark.parametrize("body", [{"title": ""}, {"title": "  "}, {"title": None}, {"kind": "fictional"}, {"owner_id": "outsider"}, {}])
def test_invalid_updates(env, body):
    c = env["client"]("owner")
    cid = make(c)["id"]
    assert c.patch(f"/v1/cases/{cid}", headers=headers(c, cid), json=body).status_code == 422


def test_optimistic_concurrency_archive_delete_cascade(env):
    c = env["client"]("owner")
    cid = make(c)["id"]
    assert grant(c, cid).status_code == 201
    assert c.patch(f"/v1/cases/{cid}", json={"title": "missing version"}).status_code == 428
    assert c.patch(f"/v1/cases/{cid}", headers={"If-Match": "1"}, json={"title": "stale"}).status_code == 409
    assert c.patch(f"/v1/cases/{cid}", headers=headers(c, cid), json={"state": "archived"}).status_code == 200
    assert c.patch(f"/v1/cases/{cid}", headers=headers(c, cid), json={"title": "archived edit"}).status_code == 409
    assert grant(c, cid).status_code == 409
    assert c.patch(f"/v1/cases/{cid}", headers=headers(c, cid), json={"state": "active"}).status_code == 200
    assert c.request("DELETE", f"/v1/cases/{cid}", headers=headers(c, cid), json={}).status_code == 204
    assert c.get(f"/v1/cases/{cid}").status_code == 404
    with env["database"].transaction() as db:
        for table in (members, grants, audit):
            assert db.execute(select(func.count()).select_from(table).where(table.c.case_id == cid)).scalar_one() == 0


def test_offline_authorization_no_upload_and_scope_gate(env):
    c = env["client"]("owner")
    cid = make(c)["id"]
    service, actor = env["service"], env["ids"]["owner"]
    with env["database"].transaction() as db, pytest.raises(Problem) as error:
        service.processing_gate(db, cid, actor, None, "document_analysis", "participant-supplied-records")
    assert error.value.code == "AUTHORIZATION_REQUIRED"
    r = grant(c, cid)
    assert r.status_code == 201
    g = r.json()
    assert g["method"] == "written_consent_held_offline" and g["status"] == "active"
    assert g["recorded_by"] == actor and "file" not in g
    with env["database"].transaction() as db:
        assert service.processing_gate(db, cid, actor, g["id"], "document_analysis", "participant-supplied-records")["basis"] == "offline_record"
    for action, source in [("image_review", "participant-supplied-records"), ("document_analysis", "other")]:
        with env["database"].transaction() as db, pytest.raises(Problem):
            service.processing_gate(db, cid, actor, g["id"], action, source)
    assert c.post(f"/v1/cases/{cid}/authorizations/{g['id']}/revoke", headers=headers(c, cid), json={"reason": "Participant withdrew"}).status_code == 200
    with env["database"].transaction() as db, pytest.raises(Problem):
        service.processing_gate(db, cid, actor, g["id"], "document_analysis", "participant-supplied-records")
    assert c.get(f"/v1/cases/{cid}/authorizations").json()["items"][0]["status"] == "revoked"


def test_authorization_expiry_forgery_and_case_isolation(env):
    c = env["client"]("owner")
    cid, other = make(c)["id"], make(c)["id"]
    future = datetime.fromtimestamp(NOW + 60, timezone.utc).isoformat()
    g = grant(c, cid, expires_at=future).json()
    assert grant(c, cid, recorded_by="forged").status_code == 422
    assert grant(c, cid, method="verified").status_code == 422
    assert grant(c, cid, signed_on="2027-01-01").status_code == 422
    assert grant(c, cid, expires_at="2020-01-01T00:00:00Z").status_code == 422
    assert c.post(f"/v1/cases/{other}/authorizations/{g['id']}/revoke", headers=headers(c, other), json={"reason": "wrong case"}).status_code == 404
    env["now"][0] += 60
    assert c.get(f"/v1/cases/{cid}/authorizations").json()["items"][0]["status"] == "expired"
    with env["database"].transaction() as db, pytest.raises(Problem):
        env["service"].processing_gate(db, cid, env["ids"]["owner"], g["id"], "document_analysis", "participant-supplied-records")


def test_audit_transaction_rolls_back_on_failure(env, monkeypatch):
    c = env["client"]("owner")
    cid = make(c)["id"]
    def fail(*args, **kwargs):
        raise RuntimeError("simulated audit-store failure")
    monkeypatch.setattr(env["service"], "log", fail)
    with pytest.raises(RuntimeError):
        env["service"].patch(cid, env["ids"]["owner"], 1, {"title": "must roll back"})
    unchanged = c.get(f"/v1/cases/{cid}").json()
    assert unchanged["title"] == "Case A" and unchanged["version"] == 1


def test_concurrent_writes_one_winner(env):
    c = env["client"]("owner")
    cid = make(c)["id"]
    def attempt(title):
        try:
            env["service"].patch(cid, env["ids"]["owner"], 1, {"title": title})
            return 200
        except Problem as e:
            return e.status
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(attempt, ["A", "B"])) == [200, 409]
    events = c.get(f"/v1/cases/{cid}/audit?limit=1").json()
    assert len(events["items"]) == 1 and events["next_after"] is not None
    next_page = c.get(f"/v1/cases/{cid}/audit?after={events['next_after']}").json()
    assert len(next_page["items"]) == 1 and next_page["items"][0]["case_version"] == 2
