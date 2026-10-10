"""Versioned, explicit schema initialization; SQLAlchemy SQLite/PostgreSQL contract."""
from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from sqlalchemy import (JSON, Boolean, CheckConstraint, Column, Float, ForeignKey,
                        Integer, MetaData, String, Table, Text, create_engine, event,
                        insert, inspect, select)

metadata = MetaData()
revisions = Table("schema_revisions", metadata, Column("version", Integer, primary_key=True))
users = Table("users", metadata,
    Column("id", String(32), primary_key=True), Column("username", String(64), nullable=False, unique=True),
    Column("password_hash", String(256), nullable=False), Column("disabled", Boolean, nullable=False),
    Column("created_at", Float, nullable=False))
sessions = Table("sessions", metadata,
    Column("digest", String(64), primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("expires_at", Float, nullable=False), Column("last_seen", Float, nullable=False))
limits = Table("login_limits", metadata,
    Column("key", String(80), primary_key=True), Column("window", Integer, nullable=False),
    Column("count", Integer, nullable=False), Column("expires_at", Float, nullable=False))
cases = Table("cases", metadata,
    Column("id", String(32), primary_key=True), Column("title", String(160), nullable=False),
    Column("description", Text, nullable=False), Column("kind", String(16), nullable=False),
    Column("state", String(16), nullable=False), Column("version", Integer, nullable=False),
    Column("created_at", Float, nullable=False), Column("updated_at", Float, nullable=False),
    CheckConstraint("kind IN ('self','participant','fictional')"),
    CheckConstraint("state IN ('active','archived')"))
members = Table("case_members", metadata,
    Column("case_id", ForeignKey("cases.id", ondelete="CASCADE"), primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role", String(16), nullable=False), CheckConstraint("role IN ('owner','editor','viewer')"))
grants = Table("authorizations", metadata,
    Column("id", String(32), primary_key=True),
    Column("case_id", ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("participant_reference", String(160), nullable=False), Column("purpose", Text, nullable=False),
    Column("source_scope", JSON, nullable=False), Column("actions", JSON, nullable=False),
    Column("method", String(32), nullable=False), Column("recorded_by", ForeignKey("users.id"), nullable=False),
    Column("recorded_at", Float, nullable=False), Column("signed_on", String(10), nullable=True),
    Column("expires_at", Float, nullable=True), Column("revoked_at", Float, nullable=True),
    Column("revoked_by", String(32), nullable=True), Column("revocation_reason", Text, nullable=True),
    CheckConstraint("method = 'written_consent_held_offline'"))
audit = Table("case_audit", metadata,
    Column("seq", Integer, primary_key=True, autoincrement=True),
    Column("case_id", ForeignKey("cases.id", ondelete="CASCADE"), nullable=False, index=True),
    Column("actor_id", String(32), nullable=False), Column("action", String(64), nullable=False),
    Column("resource_id", String(32), nullable=False), Column("at", Float, nullable=False),
    Column("case_version", Integer, nullable=False))


class Database:
    def __init__(self, url: str):
        self.engine = create_engine(url, echo=False, pool_pre_ping=True,
            connect_args={"check_same_thread": False, "timeout": 15} if url.startswith("sqlite:") else {})
        if self.engine.dialect.name == "sqlite":
            @event.listens_for(self.engine, "connect")
            def configure_sqlite(dbapi, _):
                dbapi.isolation_level = None
                dbapi.execute("PRAGMA foreign_keys=ON")
                dbapi.execute("PRAGMA journal_mode=WAL")
                dbapi.execute("PRAGMA secure_delete=ON")

            @event.listens_for(self.engine, "begin")
            def begin_immediate(connection):
                # Serialize read-modify-write transactions, including membership checks.
                connection.exec_driver_sql("BEGIN IMMEDIATE")

    @contextmanager
    def transaction(self):
        with self.engine.begin() as connection:
            yield connection

    def migrate(self):
        """Run once as a release/CLI step, never automatically in an HTTP request."""
        with self.transaction() as db:
            if self.engine.dialect.name == "postgresql":
                db.exec_driver_sql("SELECT pg_advisory_xact_lock(70512002)")
            if inspect(db).has_table("schema_revisions"):
                versions = list(db.execute(select(revisions.c.version)).scalars())
                if versions != [1]:
                    raise RuntimeError("Unsupported schema version; do not run an older service.")
            else:
                metadata.create_all(db)
                db.execute(insert(revisions).values(version=1))
        if self.engine.dialect.name == "sqlite":
            path = self.engine.url.database
            if path and path != ":memory:":
                os.chmod(Path(path), 0o600)

    def check_schema(self):
        with self.transaction() as db:
            if not inspect(db).has_table("schema_revisions"):
                raise RuntimeError("Database is not initialized. Run the migrate CLI command.")
            if list(db.execute(select(revisions.c.version)).scalars()) != [1]:
                raise RuntimeError("Unsupported database version.")

    def close(self):
        self.engine.dispose()
