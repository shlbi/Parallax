"""Opaque server sessions; no public registration or browser-stored access tokens."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import threading
from sqlalchemy import case, delete, insert, select, update
from .database import limits, sessions, users


class Problem(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)


_password_slots = threading.BoundedSemaphore(2)


def hash_password(password: str, salt: str | None = None) -> str:
    if not 12 <= len(password) <= 1024:
        raise ValueError("Passwords must contain 12 to 1024 characters.")
    salt = salt or secrets.token_hex(16)
    with _password_slots:
        derived = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768,
                                 r=8, p=3, dklen=32, maxmem=64 * 1024 * 1024)
    return "scrypt-32768-8-3:" + salt + ":" + derived.hex()


# Equal-cost work for unknown users. No account is provisioned with this value.
DUMMY_PASSWORD = "scrypt-32768-8-3:" + "00" * 16 + ":" + "00" * 32


def check_password(password: str, stored: str) -> bool:
    try:
        method, salt, digest_value = stored.split(":")
        if method != "scrypt-32768-8-3" or len(salt) != 32 or len(digest_value) != 64:
            return False
        # Bound work even for short login passwords without leaking account existence.
        attempt = password if 12 <= len(password) <= 1024 else "invalid-password-padding"
        candidate = hash_password(attempt, salt)
        return 12 <= len(password) <= 1024 and hmac.compare_digest(candidate, stored)
    except (ValueError, TypeError):
        return False


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_token(token: str) -> str:
    return hmac.new(token.encode(), b"parallax-csrf-v1", hashlib.sha256).hexdigest()


def provision_user(database, username: str, password: str, now: float):
    username = username.lower()
    if not re.fullmatch(r"[a-z0-9_.-]{3,64}", username):
        raise ValueError("Use a 3–64 character username with letters, numbers, dots, underscores or hyphens.")
    encoded = hash_password(password)
    value = {"id": secrets.token_hex(16), "username": username, "password_hash": encoded,
             "disabled": False, "created_at": now}
    with database.transaction() as db:
        db.execute(insert(users).values(**value))
    return value["id"]


def rate_attempt(database, key: str, maximum: int, seconds: int, now: float):
    # Atomic upsert, shared by all processes using this database. No trusted client-IP header.
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    statement = (pg_insert if database.engine.dialect.name == "postgresql" else sqlite_insert)(limits)
    window = int(now // seconds)
    statement = statement.values(key=key, window=window, count=1, expires_at=now + seconds)
    statement = statement.on_conflict_do_update(index_elements=[limits.c.key], set_={
        "window": window, "count": case((limits.c.window == window, limits.c.count + 1), else_=1),
        "expires_at": now + seconds}).returning(limits.c.count)
    with database.transaction() as db:
        db.execute(delete(limits).where(limits.c.expires_at < now))
        count = db.execute(statement).scalar_one()
    if count > maximum:
        raise Problem(429, "RATE_LIMITED", "Too many login attempts. Try again later.")


def authenticate(database, settings, token: str, csrf: str, write: bool, now: float):
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        raise Problem(401, "UNAUTHENTICATED", "Sign in to access cases.")
    with database.transaction() as db:
        row = db.execute(select(users.c.id, users.c.username, users.c.disabled,
            sessions.c.expires_at, sessions.c.last_seen).join(sessions, users.c.id == sessions.c.user_id)
            .where(sessions.c.digest == token_digest(token))).mappings().first()
        if (not row or row["disabled"] or row["expires_at"] <= now
                or row["last_seen"] + settings.idle_seconds <= now):
            raise Problem(401, "UNAUTHENTICATED", "Your session has ended. Sign in again.")
        if write and not hmac.compare_digest(csrf_token(token).encode(), csrf.encode()):
            raise Problem(403, "CSRF_REJECTED", "Reload the page before making changes.")
        db.execute(update(sessions).where(sessions.c.digest == token_digest(token)).values(last_seen=now))
        return {"id": row["id"], "username": row["username"]}
