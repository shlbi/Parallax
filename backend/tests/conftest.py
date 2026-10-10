import shutil
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from backend.case_service.api import create_app
from backend.case_service.config import Settings
from backend.case_service.database import Database
from backend.case_service.security import provision_user

PASSWORD = "test-only-long-passphrase"
ORIGIN = "http://localhost:3000"
NOW = datetime(2026, 10, 9, 12, tzinfo=timezone.utc).timestamp()


@pytest.fixture(scope="session")
def seed(tmp_path_factory):
    path = tmp_path_factory.mktemp("seed") / "cases.sqlite3"
    db = Database("sqlite:///" + str(path))
    db.migrate()
    ids = {name: provision_user(db, name, PASSWORD, NOW) for name in ("owner", "editor", "viewer", "outsider")}
    db.close()
    return path, ids


@pytest.fixture
def env(tmp_path, seed):
    source, ids = seed
    path = tmp_path / "cases.sqlite3"
    shutil.copy2(source, path)
    settings = Settings("sqlite:///" + str(path), allowed_hosts=("testserver",))
    now = [NOW]
    app = create_app(settings, clock=lambda: now[0])
    clients = []

    def client(name=None):
        c = TestClient(app)
        c.__enter__()
        c.headers["Origin"] = ORIGIN
        c.headers["Content-Type"] = "application/json"
        clients.append(c)
        if name:
            r = c.post("/v1/session", json={"username": name, "password": PASSWORD})
            assert r.status_code == 200, r.text
            c.headers["X-Parallax-CSRF"] = r.json()["csrf_token"]
        return c

    yield {"app": app, "client": client, "settings": settings, "now": now, "ids": ids,
           "database": app.state.database, "service": app.state.service}
    for c in reversed(clients):
        c.__exit__(None, None, None)
    app.state.database.close()
