# Tauri Shinylive Harness

Reusable Tauri + Shinylive harness for generating, validating, packaging, and preparing release candidates for bundled Shinylive/webR apps inside a desktop shell.

The harness is now config-driven:

- `harness.toml` is the app catalog and distribution source of truth.
- `node scripts/harness.mjs` provides `new`, `add-app`, `list`, `doctor`, `export`, `prepare`, `verify-static`, `verify`, and `build`.
- The portal supports multiple configured apps with search, selection, same-origin iframe loading, diagnostics, and JSON report download.
- `dist/manifest.json` aggregates `apps/*/harness-app.json`.
- App manifests can include `dataPack` file hashes and DOM probes for richer verification.
- `dist/harness-bundle-manifest.json` records file-level SHA-256 hashes.
- `dist/checksums/SHA256SUMS`, `dist/reports/sbom.json`, and `dist/reports/licenses.md` are generated during prepare.
- Playwright E2E verifies portal diagnostics, Shiny smoke text, optional DOM probes, and zero external HTTP(S) requests.
- Phase 3 preflight checks Apple signing/notarization/GitHub release readiness without printing secrets.
- `release/` packaging creates app archive, DMG/pkg when available, checksums, release notes, and validation pack.
- GitHub Actions workflows are included for CI and release-candidate builds.

## Commands

Fast path for this repository:

```sh
npm ci
npm run doctor
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
node scripts/harness.mjs list
node scripts/harness.mjs doctor
node scripts/harness.mjs export safety-summary
node scripts/harness.mjs verify-static
node scripts/e2e-verify.mjs
npm run phase3:preflight
npm run phase3:package
npm run phase3:release-draft
```

## Current Deliverables

- Reusable v0.4.0 CLI/template foundation.
- Two bundled Shinylive R apps: `subject-safety-mini` and `subject-profile-reference`.
- Clinical demo data pack with synthetic demographics, visits, labs, vitals, AEs, concomitant meds, and exposure.
- Data pack SHA-256 traceability in `harness-app.json` and `dist/manifest.json`.
- Subject Profile Reference App with Overview, Timeline, Labs, AEs, and Meds tabs.
- Multi-app-ready diagnostics portal.
- Multi-app scaffold smoke test through `npm run smoke:multi-app`.
- Embedded Rust loopback static server with COOP/COEP/CORP, CSP, MIME mapping, and path traversal protection.
- macOS `.app` build via Tauri.
- Static bundle manifest, checksums, SBOM seed, license inventory, audit log, and generated verification procedure.
- Phase 3 release candidate preflight, package assembly, validation pack, and GitHub draft release automation.

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
- `docs/clinical-demo-data-pack.md`
- `docs/generated/verification-procedure.md`
- `docs/verification.md`
- `docs/release-template.md`
- `docs/phase3-distribution.md`
- `docs/validation-approval-template.md`
- `docs/adr/0001-localhost-static-server.md`
- `docs/app-assets-contract.md`
