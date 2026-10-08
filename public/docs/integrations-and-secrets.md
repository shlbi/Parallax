# PARALLAX: providers, local mode and cloud secrets

8 October 2026 · Implementation specification

**Status:** the dashboard runs. The provider adapters, encrypted vault, settings API and Python workers described below are a plan, not working features in the current release.

## One codebase, two runtimes

Run the same dashboard against the same Python API contract locally or online. Provider adapters ask one server-side `CredentialResolver` for credentials. They never know whether a key came from an environment variable, a local encrypted file or a hosted secret store. Moving environments changes configuration, not integration code.

| Local installation | Hosted deployment |
| --- | --- |
| Dashboard at localhost | Dashboard on Vercel/custom domain |
| FastAPI and optional workers on the user's computer | FastAPI and workers on managed compute |
| Encrypted vault in the OS application-data directory | Vercel/backend environment variables; optional encrypted database vault |
| PostgreSQL/Redis/object storage through a development Compose profile | Managed database, queue and private object storage |
| Optional CPU/GPU inference using the user's hardware | Private worker service sized for sustained inference |

Initial online configuration uses the owner's Vercel/backend environment variables. The domain only routes traffic; it is not credential storage. Sustained video inference and GPU workloads belong in workers. Vercel handles the dashboard and bounded API/orchestration work; workers can run locally or on a separate host. Credentials needed by a worker must be provisioned to that worker's own secret store, not assumed to appear there from Vercel.

## Provider roles

North Star publicly names OpenStreetMap, NASA Earth Observatory, MaxMind GeoIP, GeoCLIP and Ultralytics YOLOv8. Its marketing page does not reveal enough to verify its full internal stack, camera suppliers or exact NASA endpoints. The choices below are PARALLAX's proposed integrations, not claims about North Star's implementation.

| Provider | PARALLAX capability | Credential and runtime |
| --- | --- | --- |
| Google Maps Platform | Map/satellite, Earth-style 3D, Street View, place context | Restricted browser key for map rendering; separate server credential for backend APIs |
| OpenStreetMap + Leaflet | Current interactive map; geographic context | No generic OSM API key. Tile/geocoding providers have their own usage policies and possibly keys |
| NASA GIBS | Time-selectable scientific satellite imagery overlays | Public GIBS requests; no generic NASA key required |
| NASA EONET | Natural-event layers such as wildfires, storms and volcanoes | Public EONET event API; no generic NASA key required |
| Other NASA APIs | Endpoint-specific Earth products if useful | Some use an api.nasa.gov key; some Earthdata products require separate authentication |
| Ultralytics YOLO | Object boxes, class counts and aggregate activity on authorized scenes | Local Python model or exported browser model; no inference API key for local weights |
| GeoCLIP | Optional broad location hypotheses for permitted landscape/landmark images | Local model; guesses must be labeled and independently checked |
| MaxMind GeoIP | Approximate IP/network geography for owned or authorized infrastructure | Download license key or account/license credentials for web services |
| OpenAI | Ask PARALLAX, document summaries, cited claim extraction, contradictions, query interpretation and draft reports | Private server-side API key; model chosen through configuration |

Maps, IP geography, inferred photo geography and satellite imagery do not establish a person's current location. YOLO object classes do not establish personal identity. No unrestricted person-search, unknown-face identification, cross-camera identity tracking, leaked credentials, covert visitor-location collection or sensitive-trait inference is included.

A feed registry may hold operator-published or user-authorized media sources with their source URL, access permission, expected refresh interval and attribution. It must not discover unauthenticated private cameras or treat an exposed endpoint as permission to monitor it. Detection outputs attach to the scene and timestamp, not to a person dossier.

## Local dashboard credential entry

Planned flow: **Settings → Integrations → provider → Save locally → Test connection**.

The local FastAPI service receives the write, validates the provider schema, encrypts the credential and writes it atomically. A website alone cannot silently write a protected file on the user's desktop. Running the local service makes this a local application workflow without requiring Electron.

Use the OS application-data directory, not the visible Desktop or Git checkout:

- Windows: `%LOCALAPPDATA%\PARALLAX\secrets.enc`
- macOS: `~/Library/Application Support/PARALLAX/secrets.enc`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/parallax/secrets.enc`

Store authenticated ciphertext using an established cryptography library. Protect the randomly generated vault key with Windows Credential Manager/DPAPI, macOS Keychain or Linux Secret Service. Do not save the decryption key in the same directory as the ciphertext. For machines without a supported keychain, require explicit passphrase unlock; derive a key with a standard memory-hard KDF, store the salt and parameters, and retain the unlocked key only in process memory. Never silently fall back to plaintext. An encrypted export can be portable, but an OS-bound vault is not automatically portable to another machine.

Limit filesystem access to the current user, reject unsafe symlink locations and implement transactional writes and file locking. The local API binds to loopback and validates Host, Origin and authenticated session/CSRF protections. A random startup session token or pairing flow prevents arbitrary websites from issuing local credential writes. Validate sizes and fields; never log request bodies or upstream Authorization headers.

The UI returns only `configured`, `storage_source`, `last_tested_at` and a redacted error code. It supports replacement and deletion without returning the original key. Leaving a password field blank preserves the existing value. Key deletion is explicit. Saving and testing are separate actions because tests can contact a provider and incur a small charge.

## Cloud configuration and optional dashboard entry

**Path A — environment settings:** the owner enters private keys in Vercel and in the Python worker host's secret settings. The dashboard shows a masked status and “managed by environment.” It does not overwrite infrastructure-managed values. On Vercel, changed environment values apply to a new deployment; no adapter rewiring is needed. Local mode uses the same variable names in an ignored `.env.local` file or its encrypted vault, with separate local credentials.

**Path B — authenticated hosted settings:** if dashboard entry online is desired, encrypt credentials in a persistent database/secret manager, scoped to the authenticated owner or tenant. Protect encryption keys through a KMS or separately managed master key; require authorization on reads, writes, tests and deletion. The hosted filesystem is not a durable secret store. A site visitor must never be able to change or spend the site owner's credentials.

For the single-owner first version, prefer Path A. A multi-user bring-your-own-key system needs the complete authorization and encryption design before exposing an input form publicly.

Credential resolution, server-side only:

1. Explicit deployment environment value.
2. Authorized local/hosted vault entry for that installation or account.
3. “Not configured” state; disable only the affected integration.

Show the winning source so an environment override cannot silently confuse a dashboard edit. No automatic credential synchronization between a local machine and Vercel. No keys in Git, application exports, localStorage or client-readable cookies.

## Google browser keys are a separate class

Map-rendering keys necessarily reach the browser. Restrict them by HTTP referrer and allowed APIs, with separate localhost and production keys. Private OpenAI, server Google, database and worker keys must never be delivered to the browser. Enabling every Google API is unnecessary; enable and restrict only those used by the chosen adapter. The supplied Google console screenshot shows service enablement, not proof that a key has the right restrictions or that billing is configured.

Expose only the restricted map key and non-secret configuration through a runtime configuration endpoint. Avoid compiling secrets into `NEXT_PUBLIC_*` settings. Dynamic local-vault updates can take effect without rebuilding the application. Infrastructure-level environment changes still follow the host's deployment lifecycle.

## Intelligent analysis

The Python OpenAI adapter uses the Responses API with a configured model, explicit token/time/cost ceilings and case-filtered evidence. It produces structured proposed claims with source IDs and quotations or source spans. Reviewable claims remain distinct from confirmed records. “Ask” answers cite the active case and preserve contradictory evidence.

The model receives bounded, permitted material and read-only tools. It does not receive raw credentials, arbitrary database access or instructions from untrusted source pages as authority. Model-backed analysis is an optional feature: map, graph and local evidence browsing continue to work when it is unconfigured. User-entered data is not silently sent to a model during initial input staging.

## Configuration surface and implementation order

The future Integration settings screen lists each provider with **Not configured / Configured / Validated / Unavailable**, environment/vault source, model or layer options, masked credential input, Save, Replace, Remove and Test. A saved key is not labeled “Connected” until a real provider response validates it. No artificial connected states.

Implement in this order:

1. Credential resolver, local encrypted store and authenticated settings API; test restart persistence, tampering, wrong unlock credentials, unauthorized origins and log redaction.
2. Provider settings UI and runtime map configuration; connect actual Google maps and preserve the current OSM fallback.
3. OpenAI adapter with sourced fixture evaluations, then permitted case retrieval.
4. NASA GIBS/EONET layers and provenance timestamps.
5. Isolated vision worker with bounded authorized scene inputs, resource limits and aggregate outputs.
6. Cloud BYOK vault only after owner/tenant authentication, revocation and deletion tests pass.

The same provider contract is used throughout. No disconnected second “desktop version” is needed. Local operation is independent of Vercel; API-backed services and online imagery still require internet connectivity.

## Licensing

The current UI is MIT licensed. Ultralytics advertises AGPL-3.0 and Enterprise licensing; integrating its code or weights requires a compatible licensing decision for the resulting distribution. Keeping a dependency in another process is not assumed to remove license obligations. GeoCLIP, model weights, imagery and third-party feeds require their own notices and terms. No model weights or external camera catalog are redistributed in this release.

## Primary references

- [North Star's public provider list](https://nstarlive.com/)
- [Ultralytics inference](https://docs.ultralytics.com/modes/predict/) and [licensing](https://www.ultralytics.com/license)
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [NASA GIBS access](https://nasa-gibs.github.io/gibs-api-docs/access-basics/) and [EONET v3](https://eonet.gsfc.nasa.gov/docs/v3)
- [MaxMind web services](https://dev.maxmind.com/geoip/geolocate-an-ip/web-services/)
- [GeoCLIP official implementation](https://github.com/VicenteVivan/geo-clip)
- [OpenAI API authentication](https://developers.openai.com/api/reference/overview)
- [Google key restrictions](https://developers.google.com/maps/api-security-best-practices)
- [Vercel environment variables](https://vercel.com/docs/environment-variables) and [function limits](https://vercel.com/docs/functions/limitations)
