# Tauri Shinylive Harness

Phase 2 harness for generating, validating, and packaging bundled Shinylive/webR apps inside a Tauri desktop shell.

The harness is now config-driven:

- `harness.toml` is the app catalog and distribution source of truth.
- `node scripts/harness.mjs` provides `new`, `add-app`, `export`, `prepare`, `verify-static`, `verify`, and `build`.
- The portal supports multiple configured apps with search, selection, same-origin iframe loading, diagnostics, and JSON report download.
- `dist/manifest.json` aggregates `apps/*/harness-app.json`.
- `dist/harness-bundle-manifest.json` records file-level SHA-256 hashes.
- `dist/checksums/SHA256SUMS`, `dist/reports/sbom.json`, and `dist/reports/licenses.md` are generated during prepare.
- Playwright E2E verifies portal diagnostics, Shiny smoke text, and zero external HTTP(S) requests.
- GitHub Actions workflows are included for CI and release-candidate builds.

## Commands

```sh
npm ci
npm run export
npm run build:all
npm run verify
npm run build:harness
```

Useful direct CLI commands:

```sh
node scripts/harness.mjs add-app safety-summary --title "Safety Summary"
node scripts/harness.mjs export safety-summary
node scripts/harness.mjs verify-static
node scripts/e2e-verify.mjs
```

## Current Deliverables

- Reusable Phase 2 CLI/template foundation.
- One generated Shinylive R smoke app: `subject-safety-mini`.
- Multi-app-ready diagnostics portal.
- Embedded Rust loopback static server with COOP/COEP/CORP, CSP, MIME mapping, and path traversal protection.
- macOS `.app` build via Tauri.
- Static bundle manifest, checksums, SBOM seed, license inventory, audit log, and generated verification procedure.

## Phase 3 Boundary

The repository does not yet include production Apple signing, notarization, stapling, DMG/pkg publishing, or formal clinical validation approval. The release workflow includes placeholders for those credentials and steps.

See:

- `docs/spec.md`
- `docs/generated/verification-procedure.md`
- `docs/verification.md`
- `docs/release-template.md`
- `docs/adr/0001-localhost-static-server.md`
- `docs/app-assets-contract.md`
