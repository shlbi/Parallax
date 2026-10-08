# PARALLAX

An interactive evidence workspace with a relationship graph, geospatial view, replay, analysis panels and a source inspector.

## Current release: dashboard prototype

The frontend runs locally and can deploy on Vercel. It contains fictional entities and evidence, synthetic processing telemetry, a local input-staging form, scripted Ask PARALLAX responses, and a real Leaflet/OpenStreetMap map. Google imagery currently opens in external views.

**The research backend, encrypted credential vault, provider API connections and model-backed analysis are planned, not implemented in this release. Adding environment variables does not activate those features yet.**

## Run locally

Install Node.js 22.13 or newer and pnpm 11.25.0, then:

```sh
git clone https://github.com/shlbi/Parallax.git
cd Parallax
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:3000`. No API keys are required for the demonstration. On Windows, these commands work in PowerShell after installing Node.js and pnpm.

For a production build:

```sh
pnpm build
pnpm start
```

The local server binds to loopback. The app can run without a cloud deployment; online map tiles and future API providers still require internet access. Inputs and annotations in this prototype are session-only, not a persistent database.

## Deploy on Vercel

Import `shlbi/Parallax`, select the Next.js framework and use the repository root. `vercel.json` supplies the install and build commands. Set the production branch to `main`; subsequent pushes deploy through the Git integration.

Keep development and production credentials separate. The `.env.example` file documents the **planned** names, without values. Secrets do not belong in the repository, `NEXT_PUBLIC_*` variables, screenshots, issues or browser storage. See the [configuration design](public/docs/integrations-and-secrets.md).

## Design documents

- [Architecture](public/docs/parallax-architecture.md): Python API, workers, evidence storage, graph, event stream and deployment boundaries.
- [Providers and credentials](public/docs/integrations-and-secrets.md): verified providers, local encrypted storage, cloud configuration, planned settings UI and acceptance gates.

## Scope

The planned system supports self-research, enrolled consenting participants and source-backed evidence review. Computer vision is scoped to object detection and aggregate scene analysis on authorized sources. It does not identify unknown faces, track individuals across public cameras or derive personality and sensitive-trait profiles.

## License and attribution

Original PARALLAX application code is MIT licensed. Retain third-party notices in `vendor/` and dependencies. Map data and tiles are credited to OpenStreetMap contributors in the interface.

Ultralytics YOLO and GeoCLIP are **not bundled**. Any future implementation must preserve the applicable software, model and data licenses. Ultralytics offers AGPL-3.0 and commercial licensing; this frontend's MIT license does not relicense those dependencies or their weights.
