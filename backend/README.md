# PARALLAX case foundation — Batch 2

This service adds actual persistent cases and operator access controls. The new
Next.js page is `/cases`; the original `/` graph is still the fictional demo.
No evidence ingestion, AI, image matching, map adapters or background jobs are
claimed by this batch. Participant consent stays on paper. There is no consent
file field, document upload or biometric verification flow.

## Implemented

- Operator accounts provisioned locally by an administrator; no public signup.
- Scrypt password hashing, opaque hashed server sessions, expiry, inactivity timeout,
  logout, all-session logout, and CLI password reset/account disable.
- Case creation, paginated listing, reading, editing, archiving/restoration and deletion.
- Case-scoped owner/editor/viewer permissions checked by the backend on every route.
- Owners share with existing operator usernames, change roles and revoke membership.
  Participants themselves do not need accounts. Owner transfer is not implemented.
- Written-consent-held-offline records: participant reference, purpose, exact source
  references, permitted actions, optional signed date/expiry, recorder and revocation.
  Records are operator assertions, not independently verified identity or legal advice.
- Version checks (`If-Match`) reject stale changes instead of overwriting them.
- Mutations and audit events commit atomically. Audit does not include passwords,
  session tokens, names or source content. It is not tamper-proof against a DB admin.
- A same-origin Next.js gateway forwards only allowlisted routes and selected headers.
  It does not expose a general URL fetch proxy or share unrelated app credentials.

## Run locally

Use Python 3.11+ (tested here on 3.13.5), Node 22.13+ and the repo's pnpm version.
Run from the repository root. Use an isolated virtual environment:

```sh
python -m venv .venv
# macOS/Linux:
. .venv/bin/activate
# Windows PowerShell instead: .venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements-test.txt
python -m backend.case_service.cli migrate
python -m backend.case_service.cli create-user --username saif
python -m uvicorn backend.case_service.api:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log
```

The create-user command prompts twice; it never accepts a password on the command
line or prints it. There is no default account or password. Create additional
operator accounts with the same command and unique usernames.

In a separate terminal, copy `.env.example` to ignored `.env.local`, keep the local
connection settings, then run `pnpm install --frozen-lockfile` and `pnpm dev`.
Open `http://localhost:3000/cases`. Python does **not** automatically read the
Next.js `.env.local` file. Set Python environment variables separately when changing
settings. The frontend and backend must use exactly the same
`PARALLAX_PUBLIC_ORIGIN`, including scheme and port, without a trailing slash.

Without `DATABASE_URL`, local SQLite goes under `%LOCALAPPDATA%/PARALLAX` on Windows,
or `$XDG_DATA_HOME/parallax` (default `~/.local/share/parallax`) on other platforms.
For a custom database, set `DATABASE_URL=sqlite:////absolute/path/cases.sqlite3`
(or an appropriate Windows SQLite URL) on the backend. Use a private directory.
SQLite is **not encrypted by this service**; use OS/disk encryption and protected
backups for sensitive case material. POSIX directory/file permissions are applied;
Windows ACLs and workstation security remain the installation owner's responsibility.

Administrative actions:

```sh
python -m backend.case_service.cli reset-password --username saif
python -m backend.case_service.cli disable-user --username operator_name
python -m backend.case_service.cli enable-user --username operator_name
python -m backend.case_service.cli schema --output backend/openapi.json
```

Resetting passwords or disabling accounts revokes all their sessions. Enabling an
account does not restore old sessions. Migrations are explicit; startup refuses
uninitialized or unsupported schema versions. Version 1 is the initial schema;
future revisions need explicit migrations, not automatic create-all at startup.

## Access and authorization semantics

| Action | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Read case, authorization records and audit | Yes | Yes | Yes |
| Edit title/description of an active case | Yes | Yes | No |
| Archive, restore or delete | Yes | No | No |
| List/change case membership | Yes | No | No |
| Add/revoke offline authorization records | Yes | No | No |

A participant case can exist as a draft without authorization. The internal
`CaseService.processing_gate` requires an active case, editor/owner role, and a
nonexpired, nonrevoked grant covering the exact action and source reference for a
participant case. Self/fictional cases use their recorded basis. This does not
validate the truth of the operator's declaration. Case kind is immutable after
creation. Later ingestion/worker code must call the gate **inside its own mutation
transaction** and recheck on execution; a frontend badge is not permission.

Source scope values are literal identifiers at this stage, not wildcard domains
or permissions to crawl. Batch 3 will add source validation. Grants cannot be
silently edited or un-revoked: revoke and record a new grant. Revocation preserves
case metadata/history for review; it does not delete the case. No existing jobs or
files can be cancelled/deleted yet because those pipelines do not exist.

Case deletion cascades through batch-2 authorizations, membership and case audit
in the active database. It does not erase old backups, guarantee forensic erasure,
or implement the future file/index deletion pipeline. Archive is reversible and
blocks processing while retaining readable records. This release caps case members
at 100 and authorization records at 200 per case.

## Hosted deployment contract — not deployed or certified in this batch

The same API uses SQLAlchemy with `postgresql+psycopg://...` on a separate Python
backend. Install `backend/requirements-postgres.txt`. Set `PARALLAX_RUNTIME=cloud`,
`DATABASE_URL`, HTTPS `PARALLAX_PUBLIC_ORIGIN`, exact backend `PARALLAX_ALLOWED_HOSTS`,
and a random 32+ character `PARALLAX_GATEWAY_SECRET` on that backend. Configure TLS
and certificate validation for the database according to the chosen provider.
Run the migration once as a release step. Do not store SQLite on Vercel's filesystem.

On Vercel configure `PARALLAX_RUNTIME=cloud`, `PARALLAX_API_BASE_URL` (HTTPS origin of
the private API, no path), the same `PARALLAX_PUBLIC_ORIGIN`, and the same gateway
secret. Keep all of these server-side; do not use `NEXT_PUBLIC_` secrets. The gateway
secret is an extra service boundary, **not** a substitute for operator sessions.
Use a unique secret per environment and do not expose the Python API directly.

Cookies use HttpOnly + SameSite=Strict; HTTPS mode adds Secure and the __Host-
prefix. Mutation requests require JSON, exact Origin and a session-bound CSRF token.
Login limits are persisted/atomic: ten attempts per normalized account per 15-minute
fixed window, plus 120 total per minute. Successful logins also count. This is a
small-workspace baseline; rate-limit policy, abuse resistance and MFA/SSO remain
production-review work. Requests are limited to 32 KiB; no uploads are accepted.

## Validation and known gaps

Run `python -m pytest backend/tests -q` and `pnpm test`. Tests create only temporary
fixture accounts, including the documented test-only password in the suite; none
are production accounts. Backend tests use real SQLite, HTTP-level FastAPI clients,
concurrency checks and a real Uvicorn socket round-trip through the Node gateway.
There is also a PostgreSQL DDL compile check, **not a live PostgreSQL integration test**.
The optional psycopg driver was selected from its published package but was not
installed/executed here. Direct Python dependencies are pinned to tested versions;
a complete transitive lock and dependency security review remain release gates.

Batch 2 does not have completed PostgreSQL testing, full Next.js install/build/lint,
React browser/mobile/accessibility tests, external penetration testing, backup/restore
drills or production deployment verification. The repo's frontend dependencies could
not be installed in the execution container (external GitHub DNS unavailable).
Do not merge into production based solely on the tests included here.

References consulted: FastAPI response cookies and lifespan testing, SQLAlchemy's
SQLite foreign-key/transaction documentation, OWASP session/CSRF/password-storage
cheat sheets, Next.js route-handler documentation, and Psycopg's published package.
These references inform implementation; they are not a certification of this service.
