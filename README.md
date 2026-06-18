# Tauri Shinylive Harness

Reusable Tauri + Shinylive harness for generating, validating, packaging, and preparing release candidates for bundled Shinylive/webR apps inside a desktop shell.

## Clinical Use Limitation

This harness and its bundled synthetic demo apps are for technical evaluation only. They are not validated medical devices and are not for clinical decision making unless an organization completes its own regulated validation and approval.

The bundled clinical demo data contract is a synthetic, non-CDISC schema for harness verification and product demonstrations. It is not an SDTM/ADaM submission model. Organizations that need submission-oriented evidence should map or replace the demo domains with their own validated CDISC/controlled terminology workflow.

The harness is now config-driven:

- `harness.toml` is the app catalog and distribution source of truth.
- `node scripts/harness.mjs` provides `new`, `add-app`, `add-data-pack`, `validate-config`, `validate-data`, `list`, `doctor`, `export`, `export-reports`, `prepare`, `verify-static`, `verify`, and `build`.
- `schemas/harness.schema.json` and `reports/harness-config-validation.json` define and record harness config validation.
- The portal supports multiple configured apps with search, selection, same-origin iframe loading, diagnostics, and JSON report download.
- `dist/manifest.json` aggregates `apps/*/harness-app.json`.
- App manifests can include `dataPack` file hashes, clinical data validation evidence, and DOM probes for richer verification.
- Apps can declare `report_templates`, and `export-reports` writes HTML report evidence with data pack hash, generated timestamp, app version, clinical-use limitation, and reviewer sign-off fields.
- `data-packs/*` stores reusable synthetic clinical data packs; `data_pack_source` links apps back to the pack that generated/validated them.
- `dist/harness-bundle-manifest.json` records file-level SHA-256 hashes, and `/__harness/integrity` verifies those hashes at runtime.
- `dist/checksums/SHA256SUMS`, `dist/reports/sbom.json`, and `dist/reports/licenses.md` are generated during prepare.
- Playwright E2E verifies portal diagnostics, Shiny smoke text, optional DOM probes, screenshot evidence, and zero external HTTP(S) requests.
- Phase 3 preflight checks macOS Apple signing/notarization, Windows code-signing, and GitHub release readiness without printing secrets.
- `release/` packaging creates macOS app/DMG/pkg or Windows installer artifacts, checksums, release notes, and validation pack.
- GitHub Actions workflows are included for macOS and Windows CI/release-candidate builds.

## Commands

Prerequisites for the full local verification path:

- Node.js and npm dependencies installed with `npm ci`
- Rust/Cargo via rustup for the embedded localhost server and Tauri shell
- R with `Rscript`; first export installs or reuses the `shinylive` R package under `.r-lib`
- Playwright Chromium installed with `npx playwright install chromium`
- Tauri OS prerequisites:
  - macOS: Xcode Command Line Tools
  - Windows: WebView2 and MSVC Build Tools
  - Linux: webkit2gtk, librsvg, and related Tauri system packages
- First Shinylive export may need network access to install R packages or download Shinylive web assets into `.shinylive-cache`

Fast path for this repository:

```sh
npm ci
npm run validate:config
npm run doctor
npm run test:unit
npm run validate:data
npm run export:reports
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
node scripts/harness.mjs export-reports --app subject-profile-reference
node scripts/harness.mjs verify --app subject-profile-reference
node scripts/harness.mjs verify-static
node scripts/e2e-verify.mjs
npm run phase3:preflight
npm run phase3:package
npm run phase3:package:windows
npm run local:audit:macos
npm run local:audit:windows
npm run phase3:release-draft
```

## Current Deliverables

- Reusable v0.9.1 CLI/template foundation.
- Two bundled Shinylive R apps: `subject-safety-mini` and `subject-profile-reference`.
- Clinical demo data packs with synthetic demographics, visits, labs, vitals, AEs, concomitant meds, and exposure. The main Subject Profile pack has 30 subjects, with additional oncology, vaccine, and chronic-disease scenario packs under `data-packs/*`.
- Data-pack registry under `data-packs/*` with app-level `data_pack_source` traceability.
- Clinical data pack schema and validator with required column, referential integrity, timeline, data dictionary, and hash report checks.
- Data pack SHA-256 traceability in `harness-app.json` and `dist/manifest.json`.
- Subject Profile Reference App v2 with subject selector, lab selector, AE severity/relatedness/seriousness summaries, exposure/AE timeline, and in-app data pack hash display.
- Subject Profile Reference App reports: Subject Snapshot, Safety Review, and Data Listing.
- Report Template Registry under `templates/reports/*`, plus generated HTML reports under `reports/exported/*`.
- Review workflow evidence under `reports/review-workflow.json`, `docs/generated/report-export-index.md`, and the Phase 3 validation pack.
- App template registry for generating subject profile apps from `--template subject-profile`.
- Multi-app-ready diagnostics portal.
- Multi-app scaffold smoke test through `npm run smoke:multi-app`.
- Embedded Rust loopback static server with COOP/COEP/CORP, CSP, MIME mapping, and path traversal protection.
- Runtime bundle integrity endpoint exposed at `/__harness/integrity`.
- macOS `.app` and Windows NSIS installer builds via Tauri.
- Static bundle manifest, checksums, SBOM/license inventory, audit log, and generated verification procedure.
- Phase 3 release candidate preflight, package assembly, screenshot/data/config/integrity validation evidence pack, manual clean macOS/Windows checklists, and GitHub draft release automation.

## Phase 3 Boundary

The repository can now drive the Phase 3 path up to credential-ready macOS and Windows release candidates. Production Apple Developer ID signing/notarization, Windows code signing, and public GitHub Release publication require credentials. Formal clinical validation approval still requires organization review and signoff.

Credential-free local release candidate:

```sh
npm run build:release-local
npm run build:release-windows-local
```

These local commands now write `reports/local-release-audit-<platform>.json`, update `reports/local-release-audit.json` with the latest audit, and generate `docs/generated/local-release-audit-<platform>.md` so unsigned internal readiness, missing signing, and pending clean-machine install verification are explicit.

Credential-backed release candidate:

```sh
npm run phase3:preflight
npm run tauri:build:app
npm run phase3:package
npm run phase3:preflight:windows
npm run tauri:build:windows
npm run phase3:package:windows
npm run phase3:release-draft
```

See:

- `docs/spec.md`
- `docs/quickstart.md`
- `docs/template-cli.md`
- `docs/clinical-data-contract.md`
- `docs/clinical-demo-data-pack.md`
- `docs/report-export.md`
- `docs/generated/verification-procedure.md`
- `docs/verification.md`
- `docs/manual-clean-macos-checklist.md`
- `docs/manual-clean-windows-checklist.md`
- `docs/release-template.md`
- `docs/phase3-distribution.md`
- `docs/validation-approval-template.md`
- `docs/adr/0001-localhost-static-server.md`
- `docs/app-assets-contract.md`
- `AGENTS.md`
