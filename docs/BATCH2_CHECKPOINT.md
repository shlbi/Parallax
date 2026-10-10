# PARALLAX — Batch 2 checkpoint

## Scope completed

Persistent case foundation, operator access controls, and authorization records
where signed consent is held offline. Parent: batch 1 `3aaa5af`.

The additive `/cases` route has operator login, create/list/select/edit case,
archive/restore/delete, owner/editor/viewer access management, offline authorization
records and revocation, and paginated audit history. It talks to an implemented
FastAPI service through `/api/core`; it does not edit the fictional root dashboard.
No consent scan, upload, participant login or facial-verification step was added.

The backend includes SQLAlchemy schema version 1 with an explicit migration CLI,
SQLite persistence for local installations, PostgreSQL dialect configuration for
hosted use, password hashing, hashed opaque sessions, idle/absolute expiry, logout,
all-session revocation, CLI account creation/reset/disable, per-case permissions,
CSRF/Origin/Host checks, bounded JSON bodies, login throttling, version conflicts,
transactional audit records, exact-scope authorization gating, and cascading deletion
of batch-2 case records. State-changing endpoints do not trust client-supplied roles.

## Actual validation

- 73 Python tests passed against the implemented service; statement coverage 93%.
- 34 Node tests passed against the production gateway, with mocked upstream responses.
- Existing batch 1: all 68 tests still pass. Combined: 175 tests, no failures/skips.
- One Python test launches actual Uvicorn and calls the production Node gateway over
  loopback HTTP: login, create/read case, record/revoke authorization, audit and logout.
- Persistence survives service recreation against the same SQLite file.
- Multiple account/role tests reject unrelated case reads and mutations; membership
  removal takes effect on subsequent requests. Viewer writes and owner demotion fail.
- Stale/concurrent edits reject with conflict; injected audit failure rolls back
  case updates. Authorization expiry, revocation and cross-case scope rejection pass.
- PostgreSQL schema DDL compiles; no live PostgreSQL operation was tested.
- Targeted strict TypeScript check passes for `lib/case-gateway.ts` using TypeScript
  5.8.3. New TSX/route files pass transpilation/syntax checks, not React rendering tests.
- Python 3.13.5 and Node 22.16.0 were used. Direct backend dependency versions are in
  `backend/requirements*.txt`. The repo's TypeScript version is 5.9.3, not the locally
  available 5.8.3. No frontend dependency versions or lockfile were changed.

## Not completed / not claimed

No full project install/typecheck/ESLint/Next.js build, rendered browser/mobile tests,
live PostgreSQL integration, backend hosting, production Vercel verification,
security certification, backup/restore drills or provider testing. The container
could not resolve GitHub for a checkout and did not have React/Next.js installed.
The optional PostgreSQL driver is pinned but was not installed/tested here.

No evidence ingestion, file upload pipeline, AI research, graph/data integration,
provider settings/vault, camera feeds, face matching or identity tracking was added.
Self/participant/fictional labels are operator declarations, not verification.
The original `/` dashboard remains a demonstration; use `/cases` for batch-2 records.
Deleting a case removes current batch-2 database records, not old backups or future
file/index copies. The SQLite database is not encrypted by this service.

## Release status

This checkpoint is for a review branch based on batch 1. It is not a merge into
main, not a production deployment, and not a claim that the entire system is done.
Full frontend and hosted-database checks must pass before a production release.

STOP after Batch 2. Batch 3 is validated file intake and permitted-source retrieval,
and must not begin until the owner says continue.
