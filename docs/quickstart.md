# Quickstart

## Use This Repository

```sh
npm ci
npm run validate:config
npm run doctor
npm run validate:data
npm run smoke:multi-app
npm run verify
npm run build:release-local
```

Expected:

- `validate:config` checks `harness.toml` against the normalized harness contract.
- `doctor` reports local harness config health.
- `validate:data` checks the clinical data pack contract and writes a hash-linked data dictionary.
- `smoke:multi-app` creates a temporary generated harness, adds a basic app, adds a subject-profile template app, and validates its data pack.
- `verify` validates data packs, exports every configured app, builds the portal, runs TypeScript/Rust checks, runs static verification, and runs Playwright E2E with screenshots.
- `build:release-local` creates an unsigned internal app/DMG/pkg release candidate and validation evidence pack.

This repository currently exports two apps:

- `subject-safety-mini`
- `subject-profile-reference`

The Subject Profile app verifies `SUBJ-001 AE count: 3`, the rendered ALT trend image, the exposure/AE timeline image, and the in-app data pack hash from a synthetic clinical data pack.

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
- clinical data pack schema and validator
- harness config schema and validator
- reusable synthetic data-pack registry
- reusable subject-profile app template
- CI/release workflow templates
- Phase 3 readiness and validation-pack tooling

## Add Apps

```sh
npm run harness -- add-app lab-trends-mini --title "Lab Trends Mini"
npm run harness -- add-app subject-profile-copy --title "Subject Profile Copy" --template subject-profile
npm run harness -- validate-config
npm run harness -- validate-data subject-profile-copy
npm run harness -- list
npm run verify
```

Every app gets a `shinylive-src/<id>/app.R` source directory. `npm run verify` exports all configured apps and verifies every app smoke text through the portal.

For external synthetic packs, attach and validate the data pack:

```sh
npm run harness -- add-data-pack subject-profile-copy ./clinical-demo-data --id clinical-demo-copy-v1 --copy
npm run harness -- verify --app subject-profile-copy
```

For richer apps, add `data_pack`, `data_pack_source`, `data_paths`, and optional `dom_probes` to the app entry in `harness.toml`. The generated app manifest will include the data pack source path and hash, and E2E will wait for each DOM probe.

## Release Candidate

```sh
npm run build:release-local
```

This writes `release/` with app zip, DMG, pkg, checksums, release notes, SBOM/license evidence, config validation evidence, runtime bundle integrity evidence, clinical data validation evidence, Playwright screenshots, manual clean macOS checklist, and `validation-pack.zip`.
