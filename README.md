# Tauri Shinylive Harness

Reusable Tauri + Shinylive harness for generating, validating, packaging, and preparing release candidates for bundled Shinylive/webR apps inside a desktop shell.

The harness is now config-driven:

- `harness.toml` is the app catalog and distribution source of truth.
- `node scripts/harness.mjs` provides `new`, `add-app`, `add-data-pack`, `validate-config`, `validate-data`, `list`, `doctor`, `export`, `prepare`, `verify-static`, `verify`, and `build`.
- `schemas/harness.schema.json` and `reports/harness-config-validation.json` define and record harness config validation.
- The portal supports multiple configured apps with search, selection, same-origin iframe loading, diagnostics, and JSON report download.
- `dist/manifest.json` aggregates `apps/*/harness-app.json`.
- App manifests can include `dataPack` file hashes, clinical data validation evidence, and DOM probes for richer verification.
- `data-packs/*` stores reusable synthetic clinical data packs; `data_pack_source` links apps back to the pack that generated/validated them.
- `dist/harness-bundle-manifest.json` records file-level SHA-256 hashes, and `/__harness/integrity` verifies those hashes at runtime.
- `dist/checksums/SHA256SUMS`, `dist/reports/sbom.json`, and `dist/reports/licenses.md` are generated during prepare.
- Playwright E2E verifies portal diagnostics, Shiny smoke text, optional DOM probes, screenshot evidence, and zero external HTTP(S) requests.
- Phase 3 preflight checks Apple signing/notarization/GitHub release readiness without printing secrets.
- `release/` packaging creates app archive, DMG/pkg when available, checksums, release notes, and validation pack.
- GitHub Actions workflows are included for CI and release-candidate builds.

## Commands

Fast path for this repository:

```sh
npm ci
npm run validate:config
npm run doctor
npm run validate:data
npm run smoke:multi-app
npm run export
npm run build:all
npm run verify
npm run build:harness
npm run build:release-local
```

Create a fresh harness project from this template:

```sh
npm run harness -- new ../my-shinylive-harness \
  --name my-shinylive-harness \
  --portal-title "My Shinylive Portal"
cd ../my-shinylive-harness
npm ci
npm run verify
```

Useful direct CLI commands:

```sh
node scripts/harness.mjs add-app safety-summary --title "Safety Summary"
node scripts/harness.mjs add-app subject-profile-copy --template subject-profile
node scripts/harness.mjs add-data-pack subject-profile-copy ./my-data-pack --id my-synthetic-pack-v1 --copy
node scripts/harness.mjs validate-config
node scripts/harness.mjs validate-data subject-profile-reference
node scripts/harness.mjs list
node scripts/harness.mjs doctor
node scripts/harness.mjs export safety-summary
node scripts/harness.mjs verify --app subject-profile-reference
node scripts/harness.mjs verify-static
node scripts/e2e-verify.mjs
npm run phase3:preflight
npm run phase3:package
npm run phase3:release-draft
```

## Current Deliverables

- Reusable v0.8.0 CLI/template foundation.
- Two bundled Shinylive R apps: `subject-safety-mini` and `subject-profile-reference`.
- Clinical demo data pack with synthetic demographics, visits, labs, vitals, AEs, concomitant meds, and exposure.
- Data-pack registry under `data-packs/*` with app-level `data_pack_source` traceability.
- Clinical data pack schema and validator with required column, referential integrity, timeline, data dictionary, and hash report checks.
- Data pack SHA-256 traceability in `harness-app.json` and `dist/manifest.json`.
- Subject Profile Reference App v2 with subject selector, lab selector, AE severity/relatedness/seriousness summaries, exposure/AE timeline, and in-app data pack hash display.
- App template registry for generating subject profile apps from `--template subject-profile`.
- Multi-app-ready diagnostics portal.
- Multi-app scaffold smoke test through `npm run smoke:multi-app`.
- Embedded Rust loopback static server with COOP/COEP/CORP, CSP, MIME mapping, and path traversal protection.
- Runtime bundle integrity endpoint exposed at `/__harness/integrity`.
- macOS `.app` build via Tauri.
- Static bundle manifest, checksums, SBOM/license inventory, audit log, and generated verification procedure.
- Phase 3 release candidate preflight, package assembly, screenshot/data/config/integrity validation evidence pack, manual clean macOS checklist, and GitHub draft release automation.

## Phase 3 Boundary

The repository can now drive the Phase 3 path up to a credential-ready release candidate. Production Apple Developer ID signing, installer signing, notarization, stapling, and public GitHub Release publication require Apple/GitHub credentials. Formal clinical validation approval still requires organization review and signoff.

Credential-free local release candidate:

```sh
npm run build:release-local
```

Credential-backed release candidate:

```sh
npm run phase3:preflight
npm run tauri:build:app
npm run phase3:package
npm run phase3:release-draft
```

See:

- `docs/spec.md`
- `docs/quickstart.md`
- `docs/template-cli.md`
- `docs/clinical-data-contract.md`
- `docs/clinical-demo-data-pack.md`
- `docs/generated/verification-procedure.md`
- `docs/verification.md`
- `docs/manual-clean-macos-checklist.md`
- `docs/release-template.md`
- `docs/phase3-distribution.md`
- `docs/validation-approval-template.md`
- `docs/adr/0001-localhost-static-server.md`
- `docs/app-assets-contract.md`
- `AGENTS.md`
