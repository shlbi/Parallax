# PARALLAX — approval-gated implementation batches

Baseline inspected: `main` at `16388a0b8de2d219c1a800e0fe68a7e8d5dd54c6`.
The interrupted backend attempt did not reach that branch.

## Working agreement

Work on one batch at a time. Report implemented changes, actual checks, remaining
limitations and repository status. Stop after each batch; begin the next only after
the owner says **continue**. Do not silently publish untested work to production.
Preserve the current visual direction, Ask PARALLAX button and right/bottom panels.
Written participant consent remains offline; no consent-document upload or biometric
verification step is required. Later authorized-image work is face detection and
manual review, not unknown-face identification or cross-camera tracking.

| Batch | Scope | Status |
| --- | --- | --- |
| 1 | Existing workspace regressions and automated tests | Code and local checks complete; full app/browser validation pending |
| 2 | Durable cases, access controls and offline-consent authorization records | Not started |
| 3 | Validated file intake and explicitly permitted-source retrieval | Not started |
| 4 | Persistent evidence, review decisions, graph/analytics scope and replay | Not started |
| 5 | Case-grounded Ask PARALLAX with citations | Not started |
| 6 | Maps, provider settings and local/cloud secrets | Not started |
| 7 | Authorized-image handling, face detection and manual candidate review | Not started |
| 8 | End-to-end/security validation, deployment and operational documentation | Not started |

## Batch 1 changes

- Replace URL-prefix checking with a parsed, normalized HTTP(S) URL and reject
  missing hosts, embedded credentials, malformed ports, controls and backslashes.
  This validates local staging only; it is not a server-side SSRF defense.
- Apply the same extension/MIME/size/count checks to file-picker and drop events.
  Browser MIME may be absent, in which case a supported extension is required.
  This is not content-signature validation, malware scanning, or an upload pipeline.
- Preserve attachment metadata when intake is closed and reopened. Include retained
  references in the eight-file cap, allow removal, and combine retained metadata with
  newly selected files when restaging. Retained metadata is clearly labeled: original
  File objects and previews still do not survive modal closure. No files are uploaded.
- Plot cumulative activity only through the cursor. At zero, no future total is
  displayed; at completion the synthetic total is 185. Clamp progress safely.
- Distinguish timeline highlights from complete claim history. The existing fixture
  mentions 12 distinct claims in events and has 10 additional un-timed claims.
  Show that gap instead of fabricating discovery times. Whole case remains available.
- Limit score charts, tooltips, and extrema to reached events, using step changes
  rather than interpolating fictional changes in evidence scores.
- Label current review statuses and whole-case queue separately from historical
  replay. Keep the existing Ask demo and public component signatures.

The unchanged demo fixture is not a complete event-sourced history. Full durable
replay and cross-view filter consistency belong to batch 4. Saved-view completeness
also remains for batch 4; the keyword-based Ask behavior remains for batch 5.

## Actual local validation

Run the dependency-free checks with Node >=22.13:

```sh
npm test
# Equivalent:
node --experimental-strip-types --test tests/workspace-regressions.test.mjs tests/component-wiring.test.mjs
```

Observed in this batch:

- 61 unit tests passed against the production helper, including invariants checked
  at 1,001 replay positions.
- 7 static source-wiring checks passed. These confirm component references, not
  browser behavior or React rendering.
- Strict TypeScript checking of `lib/workspace-regressions.ts` passed using the
  available TypeScript 5.8.3 compiler.
- Both changed TSX files and the helper passed syntax/transpilation checks.
- Removing the added `test` script from `package.json` reproduces the inspected
  original Git blob hash. No dependencies, versions or lockfile were changed.

Not run: dependency installation, whole-application typecheck, ESLint, Next.js build,
rendered browser tests, Vercel deployment tests or security/production acceptance.
The execution environment could not resolve github.com for a clone and had no React,
Next.js or project ESLint installation. Source was read through the GitHub connector.
The available TypeScript version is not the repo's pinned 5.9.3.

Before merging this batch into a production branch, run the project's frozen-lockfile
install, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` and browser checks for
intake close/reopen, picker/drop parity, replay endpoints, all six views and mobile
layout. Later batches remain paused regardless of these outstanding checks.

## Technical reference for the test runner

Node 22.13's built-in TypeScript stripping executes the pure helper without a new
runtime dependency. It does not typecheck and does not support TSX rendering:
https://nodejs.org/download/release/v22.13.0/docs/api/typescript.html
