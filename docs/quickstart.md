# Quickstart

## Use This Repository

```sh
npm ci
npm run doctor
npm run smoke:multi-app
npm run verify
npm run build:release-local
```

Expected:

- `doctor` reports local harness config health.
- `smoke:multi-app` creates a temporary generated harness and adds a second app.
- `verify` exports every configured app, builds the portal, runs TypeScript/Rust checks, runs static verification, and runs Playwright E2E.
- `build:release-local` creates an unsigned internal app/DMG/pkg release candidate and validation pack.

This repository currently exports two apps:

- `subject-safety-mini`
- `subject-profile-reference`

The Subject Profile app verifies `SUBJ-001 AE count: 3` and the rendered ALT trend image from a synthetic clinical data pack.

## Create A New Harness

```sh
npm run harness -- new ../my-shinylive-harness \
  --name my-shinylive-harness \
  --portal-title "My Shinylive Portal"
cd ../my-shinylive-harness
npm ci
npm run verify
```

The generated project contains:

- Tauri shell and Rust localhost server
- React diagnostics portal
- sample Shinylive R app source
- harness CLI scripts
- CI/release workflow templates
- Phase 3 readiness and validation-pack tooling

## Add Apps

```sh
npm run harness -- add-app lab-trends-mini --title "Lab Trends Mini"
npm run harness -- list
npm run verify
```

Every app gets a `shinylive-src/<id>/app.R` source directory. `npm run verify` exports all configured apps and verifies every app smoke text through the portal.

For richer apps, add `data_pack`, `data_paths`, and optional `dom_probes` to the app entry in `harness.toml`. The generated app manifest will include the data pack hash, and E2E will wait for each DOM probe.

## Release Candidate

```sh
npm run build:release-local
```

This writes `release/` with app zip, DMG, pkg, checksums, release notes, SBOM/license evidence, and `validation-pack.zip`.
