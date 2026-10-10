"""Every case mutation checks membership and writes its audit event in one transaction."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from sqlalchemy import delete, func, insert, select, update
from .database import audit, cases, grants, members, users
from .security import Problem


class CaseService:
    def __init__(self, database, clock):
        self.database, self.clock = database, clock

    def require(self, db, case_id: str, user_id: str, roles=("owner", "editor", "viewer")) -> dict:
        # FOR UPDATE serializes permission changes and resource writes on PostgreSQL;
        # SQLite transactions use BEGIN IMMEDIATE. A revoked member cannot race a write.
        row = db.execute(select(cases, members.c.role).join(members, cases.c.id == members.c.case_id)
            .join(users, members.c.user_id == users.c.id)
            .where(cases.c.id == case_id, members.c.user_id == user_id, users.c.disabled.is_(False))
            .with_for_update()).mappings().first()
        if not row:
            raise Problem(404, "CASE_NOT_FOUND", "Case not found or access is unavailable.")
        if row["role"] not in roles:
            raise Problem(403, "FORBIDDEN", "Your case role does not permit this action.")
        return dict(row)

    @staticmethod
    def expect_version(row: dict, expected: int):
        if row["version"] != expected:
            raise Problem(409, "VERSION_CONFLICT", "This case changed. Refresh before saving again.")

    def touch(self, db, row: dict, actor: str, action: str, resource_id: str):
        version = row["version"] + 1
        now = self.clock()
        db.execute(update(cases).where(cases.c.id == row["id"], cases.c.version == row["version"])
                   .values(version=version, updated_at=now))
        self.log(db, row["id"], actor, action, resource_id, version)
        return version

    def log(self, db, case_id: str, actor: str, action: str, resource_id: str, version: int):
        # No passwords, session tokens, participant names, or source material in audit metadata.
        db.execute(insert(audit).values(case_id=case_id, actor_id=actor, action=action,
                    resource_id=resource_id, at=self.clock(), case_version=version))

    def create(self, actor: str, data: dict) -> dict:
        now = self.clock()
        value = {"id": secrets.token_hex(16), **data, "state": "active", "version": 1,
                 "created_at": now, "updated_at": now}
        with self.database.transaction() as db:
            # Check again inside the mutation transaction, not only in session middleware.
            if not db.execute(select(users.c.id).where(users.c.id == actor, users.c.disabled.is_(False))).first():
                raise Problem(401, "UNAUTHENTICATED", "Account is unavailable.")
            db.execute(insert(cases).values(**value))
            db.execute(insert(members).values(case_id=value["id"], user_id=actor, role="owner"))
            self.log(db, value["id"], actor, "case.created", value["id"], 1)
        return {**value, "role": "owner"}

    def list_cases(self, actor: str, offset: int, limit: int) -> dict:
        with self.database.transaction() as db:
            rows = db.execute(select(cases, members.c.role).join(members, cases.c.id == members.c.case_id)
                .join(users, members.c.user_id == users.c.id)
                .where(members.c.user_id == actor, users.c.disabled.is_(False))
                .order_by(cases.c.created_at.desc(), cases.c.id).offset(offset).limit(limit + 1)).mappings().all()
            return {"items": [dict(r) for r in rows[:limit]],
                    "next_offset": offset + limit if len(rows) > limit else None}

    def get(self, case_id: str, actor: str) -> dict:
        with self.database.transaction() as db:
            return self.require(db, case_id, actor)

    def patch(self, case_id: str, actor: str, expected: int, data: dict) -> dict:
        if not data:
            raise Problem(422, "EMPTY_UPDATE", "Supply at least one changed field.")
        with self.database.transaction() as db:
            row = self.require(db, case_id, actor, ("owner", "editor"))
            self.expect_version(row, expected)
            if "state" in data and row["role"] != "owner":
                raise Problem(403, "FORBIDDEN", "Only the owner can archive or restore a case.")
            if row["state"] == "archived" and data.get("state") != "active":
                raise Problem(409, "CASE_ARCHIVED", "Restore the case before editing it.")
            db.execute(update(cases).where(cases.c.id == case_id).values(**data))
            self.touch(db, row, actor, "case.updated", case_id)
            return self.require(db, case_id, actor)

    def delete(self, case_id: str, actor: str, expected: int):
        with self.database.transaction() as db:
            row = self.require(db, case_id, actor, ("owner",))
            self.expect_version(row, expected)
            # All batch-2 case-scoped rows cascade. Backups have their own retention.
            db.execute(delete(cases).where(cases.c.id == case_id))

    def membership_list(self, case_id: str, actor: str):
        with self.database.transaction() as db:
            self.require(db, case_id, actor, ("owner",))
            return [dict(r) for r in db.execute(select(members.c.user_id, users.c.username, members.c.role)
                .join(users, users.c.id == members.c.user_id).where(members.c.case_id == case_id)
                .order_by(users.c.username)).mappings()]

    def set_member(self, case_id: str, actor: str, expected: int, username: str, role: str):
        with self.database.transaction() as db:
            row = self.require(db, case_id, actor, ("owner",))
            self.expect_version(row, expected)
            target = db.execute(select(users.c.id).where(users.c.username == username.lower(),
                                                        users.c.disabled.is_(False))).scalar_one_or_none()
            if not target:
                raise Problem(404, "ACCOUNT_UNAVAILABLE", "The operator account is unavailable.")
            old = db.execute(select(members.c.role).where(members.c.case_id == case_id,
                                                          members.c.user_id == target)).scalar_one_or_none()
            if old == "owner":
                raise Problem(409, "OWNER_IMMUTABLE", "The case owner cannot be replaced or demoted.")
            if old:
                db.execute(update(members).where(members.c.case_id == case_id, members.c.user_id == target)
                           .values(role=role))
            else:
                if db.execute(select(func.count()).select_from(members).where(members.c.case_id == case_id)).scalar_one() >= 100:
                    raise Problem(409, "MEMBER_LIMIT", "This release supports up to 100 operators per case.")
                db.execute(insert(members).values(case_id=case_id, user_id=target, role=role))
            version = self.touch(db, row, actor, "member.changed", target)
            return {"user_id": target, "role": role, "case_version": version}

    def remove_member(self, case_id: str, actor: str, expected: int, target: str):
        with self.database.transaction() as db:
            row = self.require(db, case_id, actor, ("owner",))
            self.expect_version(row, expected)
            role = db.execute(select(members.c.role).where(members.c.case_id == case_id,
                                                           members.c.user_id == target)).scalar_one_or_none()
            if role == "owner":
                raise Problem(409, "OWNER_IMMUTABLE", "The case owner cannot be removed.")
            if not role:
                raise Problem(404, "MEMBER_NOT_FOUND", "Case member not found.")
            db.execute(delete(members).where(members.c.case_id == case_id, members.c.user_id == target))
            return {"case_version": self.touch(db, row, actor, "member.removed", target)}

    def grant_state(self, row) -> str:
        if row["revoked_at"] is not None:
            return "revoked"
        if row["expires_at"] is not None and row["expires_at"] <= self.clock():
            return "expired"
        return "active"

    def grant_list(self, case_id: str, actor: str):
        with self.database.transaction() as db:
            self.require(db, case_id, actor)
            return [{**dict(r), "status": self.grant_state(r)} for r in db.execute(
                select(grants).where(grants.c.case_id == case_id).order_by(grants.c.recorded_at, grants.c.id)).mappings()]

    def add_grant(self, case_id: str, actor: str, expected: int, data: dict):
        now = self.clock()
        if data.get("expires_at") is not None and data["expires_at"].timestamp() <= now:
            raise Problem(422, "EXPIRED_AUTHORIZATION", "The expiry must be in the future.")
        if data.get("signed_on") and data["signed_on"] > datetime.fromtimestamp(now, timezone.utc).date():
            raise Problem(422, "FUTURE_SIGNATURE_DATE", "The signing date cannot be in the future.")
        value = {**data, "signed_on": data["signed_on"].isoformat() if data.get("signed_on") else None,
                 "expires_at": data["expires_at"].timestamp() if data.get("expires_at") else None,
                 "id": secrets.token_hex(16), "case_id": case_id, "method": "written_consent_held_offline",
                 "recorded_by": actor, "recorded_at": now, "revoked_at": None,
                 "revoked_by": None, "revocation_reason": None}
        with self.database.transaction() as db:
            row = self.require(db, case_id, actor, ("owner",))
            self.expect_version(row, expected)
            if row["state"] != "active":
                raise Problem(409, "CASE_ARCHIVED", "Restore the case before recording authorization.")
            if db.execute(select(func.count()).select_from(grants).where(grants.c.case_id == case_id)).scalar_one() >= 200:
                raise Problem(409, "AUTHORIZATION_LIMIT", "This release supports up to 200 authorization records per case.")
            db.execute(insert(grants).values(**value))
            version = self.touch(db, row, actor, "authorization.recorded", value["id"])
            return {**value, "status": "active", "case_version": version}

    def revoke(self, case_id: str, actor: str, expected: int, grant_id: str, reason: str):
        with self.database.transaction() as db:
            row = self.require(db, case_id, actor, ("owner",))
            self.expect_version(row, expected)
            value = db.execute(select(grants).where(grants.c.case_id == case_id,
                                                    grants.c.id == grant_id)).mappings().first()
            if not value:
                raise Problem(404, "AUTHORIZATION_NOT_FOUND", "Authorization not found in this case.")
            if value["revoked_at"] is None:
                db.execute(update(grants).where(grants.c.case_id == case_id, grants.c.id == grant_id)
                           .values(revoked_at=self.clock(), revoked_by=actor, revocation_reason=reason))
                version = self.touch(db, row, actor, "authorization.revoked", grant_id)
            else:
                version = row["version"]
            return {"status": "revoked", "case_version": version}

    def processing_gate(self, db, case_id: str, actor: str, grant_id: str | None,
                        action: str, source_reference: str) -> dict:
        """Future ingestion must call this inside its write transaction, not trust the UI.

        Batch 2 does not start jobs. Scope strings are exact recorded source identifiers,
        not URL wildcard permissions; URL validation and source adapters belong to batch 3.
        """
        row = self.require(db, case_id, actor, ("owner", "editor"))
        if row["state"] != "active":
            raise Problem(409, "CASE_ARCHIVED", "Archived cases do not permit processing.")
        if row["kind"] in {"self", "fictional"}:
            return {"basis": row["kind"], "case_version": row["version"]}
        grant = db.execute(select(grants).where(grants.c.case_id == case_id,
                                                grants.c.id == grant_id)).mappings().first()
        if (not grant or self.grant_state(grant) != "active" or action not in grant["actions"]
                or source_reference not in grant["source_scope"]):
            raise Problem(403, "AUTHORIZATION_REQUIRED", "An active authorization covering this action and source is required.")
        return {"basis": "offline_record", "authorization_id": grant["id"], "case_version": row["version"]}

    def audit_list(self, case_id: str, actor: str, after: int, limit: int):
        with self.database.transaction() as db:
            self.require(db, case_id, actor)
            rows = db.execute(select(audit).where(audit.c.case_id == case_id, audit.c.seq > after)
                              .order_by(audit.c.seq).limit(limit + 1)).mappings().all()
            return {"items": [dict(r) for r in rows[:limit]],
                    "next_after": rows[limit - 1]["seq"] if len(rows) > limit else None}
