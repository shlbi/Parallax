from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    database_url: str
    public_origin: str = "http://localhost:3000"
    allowed_hosts: tuple[str, ...] = ("localhost", "127.0.0.1")
    runtime: str = "local"
    gateway_secret: str = ""
    session_seconds: int = 12 * 3600
    idle_seconds: int = 30 * 60
    max_body_bytes: int = 32 * 1024

    def __post_init__(self):
        p = urlsplit(self.public_origin)
        if (self.runtime not in {"local", "cloud"} or p.scheme not in {"http", "https"}
                or not p.hostname or p.username or p.password or p.path or p.query or p.fragment):
            raise ValueError("Invalid runtime or public origin (no trailing slash).")
        if not self.allowed_hosts or any("*" in h or "/" in h for h in self.allowed_hosts):
            raise ValueError("Configure exact backend host names, without wildcards.")
        if not self.database_url.startswith(("sqlite:///", "postgresql+psycopg://")):
            raise ValueError("Use sqlite:/// or postgresql+psycopg:// for DATABASE_URL.")
        if self.runtime == "cloud":
            if not self.database_url.startswith("postgresql+psycopg://"):
                raise ValueError("Cloud mode requires PostgreSQL, not an ephemeral SQLite file.")
            if p.scheme != "https" or len(self.gateway_secret) < 32:
                raise ValueError("Cloud mode requires HTTPS and a 32+ character gateway secret.")
        elif p.scheme == "http" and p.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Unencrypted local mode is restricted to a loopback frontend.")
        if not 60 <= self.idle_seconds <= self.session_seconds <= 86400:
            raise ValueError("Invalid session lifetime.")

    @property
    def secure_cookie(self) -> bool:
        return self.public_origin.startswith("https://")

    @property
    def cookie_name(self) -> str:
        return "__Host-parallax_session" if self.secure_cookie else "parallax_session"

    @classmethod
    def from_env(cls) -> "Settings":
        url = os.environ.get("DATABASE_URL", "")
        if not url and os.environ.get("PARALLAX_RUNTIME") == "cloud":
            raise ValueError("Cloud mode requires an explicitly configured DATABASE_URL.")
        if not url:
            # The database contains case material; keep it outside the Git checkout.
            if os.name == "nt":
                root = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "PARALLAX"
            else:
                root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "parallax"
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
            url = "sqlite:///" + str(root / "cases.sqlite3")
        return cls(database_url=url,
                   public_origin=os.environ.get("PARALLAX_PUBLIC_ORIGIN", "http://localhost:3000"),
                   allowed_hosts=tuple(h.strip() for h in os.environ.get(
                       "PARALLAX_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()),
                   runtime=os.environ.get("PARALLAX_RUNTIME", "local"),
                   gateway_secret=os.environ.get("PARALLAX_GATEWAY_SECRET", ""))
