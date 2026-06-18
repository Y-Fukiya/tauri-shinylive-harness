# Tauri Shinylive Harness

Phase 2/3 harness for generating, validating, packaging, and preparing release candidates for bundled Shinylive/webR apps inside a Tauri desktop shell.

The harness is now config-driven:

- `harness.toml` is the app catalog and distribution source of truth.
- `node scripts/harness.mjs` provides `new`, `add-app`, `export`, `prepare`, `verify-static`, `verify`, and `build`.
- The portal supports multiple configured apps with search, selection, same-origin iframe loading, diagnostics, and JSON report download.
- `dist/manifest.json` aggregates `apps/*/harness-app.json`.
- `dist/harness-bundle-manifest.json` records file-level SHA-256 hashes.
- `dist/checksums/SHA256SUMS`, `dist/reports/sbom.json`, and `dist/reports/licenses.md` are generated during prepare.
- Playwright E2E verifies portal diagnostics, Shiny smoke text, and zero external HTTP(S) requests.
- Phase 3 preflight checks Apple signing/notarization/GitHub release readiness without printing secrets.
- `release/` packaging creates app archive, DMG when available, checksums, release notes, and validation pack.
- GitHub Actions workflows are included for CI and release-candidate builds.

## Commands

```sh
npm ci
npm run export
npm run build:all
npm run verify
npm run build:harness
npm run build:release-local
```

Useful direct CLI commands:

```sh
node scripts/harness.mjs add-app safety-summary --title "Safety Summary"
node scripts/harness.mjs export safety-summary
node scripts/harness.mjs verify-static
node scripts/e2e-verify.mjs
npm run phase3:preflight
npm run phase3:package
npm run phase3:release-draft
```

## Current Deliverables

- Reusable Phase 2 CLI/template foundation.
- One generated Shinylive R smoke app: `subject-safety-mini`.
- Multi-app-ready diagnostics portal.
- Embedded Rust loopback static server with COOP/COEP/CORP, CSP, MIME mapping, and path traversal protection.
- macOS `.app` build via Tauri.
- Static bundle manifest, checksums, SBOM seed, license inventory, audit log, and generated verification procedure.
- Phase 3 release candidate preflight, package assembly, validation pack, and GitHub draft release automation.

## Phase 3 Boundary

The repository can now drive the Phase 3 path up to a credential-ready release candidate. Production Apple Developer ID signing, notarization, stapling, and public GitHub Release publication require Apple/GitHub credentials. Formal clinical validation approval still requires organization review and signoff.

Credential-free local release candidate:

```sh
npm run build:release-local
```

Credential-backed release candidate:

```sh
npm run phase3:preflight
npm run tauri:build:dmg
npm run phase3:package
npm run phase3:release-draft
```

See:

- `docs/spec.md`
- `docs/generated/verification-procedure.md`
- `docs/verification.md`
- `docs/release-template.md`
- `docs/phase3-distribution.md`
- `docs/validation-approval-template.md`
- `docs/adr/0001-localhost-static-server.md`
- `docs/app-assets-contract.md`
