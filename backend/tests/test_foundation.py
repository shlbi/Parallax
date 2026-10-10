from dataclasses import replace
import concurrent.futures
import subprocess
import sys
import json
import os
from pathlib import Path
import pytest
from sqlalchemy import select, insert, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable
from fastapi.testclient import TestClient
from backend.case_service.config import Settings
from backend.case_service.api import create_app
from backend.case_service.database import Database, metadata, members, revisions, users, sessions, audit
from backend.case_service.security import Problem, hash_password, check_password, rate_attempt
from .conftest import PASSWORD, NOW, ORIGIN
from .test_cases import make, grant, headers, share


@pytest.mark.parametrize("extra", [
    {"runtime":"cloud"}, {"runtime":"unexpected"}, {"public_origin":"http://attacker.example"},
    {"public_origin":"https://app.example/"}, {"public_origin":"https://user:pass@app.example"},
    {"allowed_hosts":("*",)}, {"database_url":"mysql://db"}, {"idle_seconds":0},
    {"session_seconds":1000000}, {"public_origin":"https://app.example/?key=x"},
])
def test_config_fails_closed(env, extra):
    with pytest.raises(ValueError):
        replace(env["settings"], **extra)


def test_cloud_config_requires_explicit_database(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("PARALLAX_RUNTIME", "cloud")
    with pytest.raises(ValueError, match="DATABASE_URL"):
        Settings.from_env()


def test_https_cookie_and_gateway(env):
    settings = replace(env["settings"], public_origin="https://app.example", gateway_secret="test-only-secret-" * 3)
    app = create_app(settings, clock=lambda: NOW)
    with TestClient(app, base_url="https://testserver") as c:
        assert c.get("/healthz").status_code == 200
        assert c.get("/v1/cases").status_code == 403
        r = c.post("/v1/session", headers={"Origin":settings.public_origin, "X-Parallax-Gateway":settings.gateway_secret}, json={"username":"owner","password":PASSWORD})
        assert r.status_code == 200
        cookie = r.headers["set-cookie"]
        assert cookie.startswith("__Host-parallax_session=") and "Secure" in cookie and "HttpOnly" in cookie
        assert "Domain=" not in cookie
        assert settings.gateway_secret not in r.text


def test_schema_explicit_idempotent_and_future_rejected(tmp_path):
    settings = Settings("sqlite:///" + str(tmp_path / "new.sqlite3"), allowed_hosts=("testserver",))
    app = create_app(settings)
    with pytest.raises(RuntimeError, match="migrate"):
        with TestClient(app): pass
    db = app.state.database
    db.migrate(); db.migrate(); db.check_schema()
    with db.transaction() as connection:
        connection.execute(update(revisions).values(version=2))
    with pytest.raises(RuntimeError): db.migrate()
    with pytest.raises(RuntimeError): db.check_schema()
    db.close()


def test_postgresql_ddl_compiles():
    # Compile-only compatibility check. This is NOT a live PostgreSQL test.
    for table in metadata.sorted_tables:
        sql = str(CreateTable(table).compile(dialect=postgresql.dialect()))
        assert "CREATE TABLE" in sql


def test_sqlite_foreign_keys_enforced(env):
    with pytest.raises(IntegrityError):
        with env["database"].transaction() as db:
            db.execute(insert(members).values(case_id="missing", user_id=env["ids"]["owner"], role="owner"))


def test_scrypt_unique_salts_and_password_rules():
    a,b=hash_password(PASSWORD),hash_password(PASSWORD)
    assert a!=b and check_password(PASSWORD,a)
    for value in ("wrong", "wrong-long-password", "", "x"*1025):
        assert not check_password(value,a)
    assert not check_password(PASSWORD,"broken")
    with pytest.raises(ValueError): hash_password("short")


def test_rate_limiter_atomic_and_expiring(env):
    def attempt(_):
        try:
            rate_attempt(env["database"],"test",5,60,NOW)
            return 200
        except Problem as p: return p.status
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        results=list(pool.map(attempt,range(10)))
    assert results.count(200)==5 and results.count(429)==5
    rate_attempt(env["database"],"test",5,60,NOW+61)


@pytest.mark.parametrize("value", ['"1', '1"', '0', '-1', '1.2', '*', 'NaN', '99999999999'])
def test_invalid_etags(env,value):
    c=env["client"]("owner");cid=make(c)["id"]
    assert c.patch(f"/v1/cases/{cid}",headers={"If-Match":value},json={"title":"test"}).status_code==422


def test_viewer_processing_denied_and_archived_gate(env):
    c=env["client"]("owner");cid=make(c,"self")["id"]
    share(c,cid,"viewer","viewer")
    with env["database"].transaction() as db,pytest.raises(Problem):
        env["service"].processing_gate(db,cid,env["ids"]["viewer"],None,"case_records","self")
    with env["database"].transaction() as db:
        assert env["service"].processing_gate(db,cid,env["ids"]["owner"],None,"case_records","self")["basis"]=="self"
    c.patch(f"/v1/cases/{cid}",headers=headers(c,cid),json={"state":"archived"})
    with env["database"].transaction() as db,pytest.raises(Problem) as error:
        env["service"].processing_gate(db,cid,env["ids"]["owner"],None,"case_records","self")
    assert error.value.code=="CASE_ARCHIVED"


def test_authorization_cross_case_gate_and_idempotent_revocation(env):
    c=env["client"]("owner");a,b=make(c)["id"],make(c)["id"]
    g=grant(c,a).json()
    with env["database"].transaction() as db,pytest.raises(Problem):
        env["service"].processing_gate(db,b,env["ids"]["owner"],g["id"],"case_records","participant-supplied-records")
    url=f"/v1/cases/{a}/authorizations/{g['id']}/revoke"
    first=c.post(url,headers=headers(c,a),json={"reason":"Withdrawn"}).json()
    second=c.post(url,headers=headers(c,a),json={"reason":"Again"}).json()
    assert first==second
    rows=c.get(f"/v1/cases/{a}/audit").json()["items"]
    assert [r['action'] for r in rows].count('authorization.revoked')==1


def test_openapi_contract_does_not_add_signup_or_upload(env):
    schema=env["app"].openapi()
    assert len(schema['paths'])==10
    assert 'multipart/form-data' not in json.dumps(schema)
    assert all('register' not in p and 'upload' not in p for p in schema['paths'])
    assert 'actor' not in [p['name'] for p in schema['paths']['/v1/cases']['get']['parameters']]


def test_disable_and_reset_cli(env,monkeypatch,capsys):
    from backend.case_service import cli
    c=env["client"]("owner")
    monkeypatch.setenv("DATABASE_URL",env["settings"].database_url)
    monkeypatch.setattr(sys,"argv",["cli","disable-user","--username","owner"])
    cli.main()
    assert c.get('/v1/session').status_code==401
    monkeypatch.setattr(sys,"argv",["cli","enable-user","--username","owner"]);cli.main()
    c=env["client"]("owner")
    monkeypatch.setattr(sys,"argv",["cli","reset-password","--username","owner"])
    monkeypatch.setattr(cli.getpass,"getpass",lambda _:"changed-test-only-passphrase")
    cli.main()
    assert c.get('/v1/session').status_code==401
    assert "changed-test-only-passphrase" not in capsys.readouterr().out
