# Offline Clinical Review Sandbox for Shinylive/webR Apps

Reusable Tauri + Shinylive/webR harness for packaging synthetic-data Shiny apps as controlled, offline-oriented desktop review sandboxes.

This repository is intended for clinical review workflow prototyping, education, internal PoC, and release-evidence workflow evaluation. It is not a validated clinical system, not clinical decision support, not PHI/PII-ready, and not submission-ready.

日本語版: [README.ja.md](README.ja.md)

## What It Helps With

- Bundle Shinylive/webR apps into a local desktop portal.
- Run apps through a localhost-only Tauri shell with static bundled assets.
- Validate synthetic clinical data packs and app metadata.
- Generate HTML/PDF demo reports and evidence packs.
- Check static bundle hashes, offline behavior, PHI/PII guardrails, Tauri security settings, and release artifacts.
- Build unsigned internal candidates locally, or signed/notarized release candidates when credentials are provided.

## Not For

Do not use this repository or its bundled demo data for:

- diagnosis, treatment decisions, or patient management
- live clinical trial operations
- real patient data, PHI, PII, site-identifiable data, or sponsor-confidential trial data
- regulatory submission
- Part 11 electronic records or signatures
- GxP production use

Any regulated use requires separate validation, approval, procedures, controls, and operational ownership by the responsible organization.

## Clinical Use Limitation

This harness and bundled demo applications are for technical evaluation, workflow prototyping, training, and synthetic-data demonstration only. They are not validated medical devices, are not clinical decision support tools, and must not be used for diagnosis, treatment, patient management, or regulatory submission unless separately validated and approved by the responsible organization.

The bundled clinical demo schema is synthetic and non-CDISC. CDISC bridge reports provide awareness and handoff evidence only; this project does not perform full SDTM/ADaM/Define-XML validation and keeps `submissionReady: false`.

## Architecture

- `harness.toml` is the source of truth for project identity, distribution settings, apps, data packs, and report templates.
- `shinylive-src/*` contains editable Shinylive app sources.
- `data-packs/*` contains reusable synthetic clinical data packs.
- `apps/*`, `dist/*`, `reports/*`, and `release/*` are generated outputs.
- `scripts/harness.mjs` is the main CLI.
- `src/` contains the diagnostics portal.
- `src-tauri/` and `crates/harness-server/` contain the Tauri shell and embedded Rust localhost server.

## Included Demo Apps

- `subject-safety-mini`: minimal Shinylive app for harness smoke testing.
- `subject-profile-reference`: subject profile reference app with selectors, labs, AEs, meds, exposure timelines, data pack hash display, and report exports.

Synthetic clinical packs include demographics, visits, labs, vitals, adverse events, concomitant medications, and exposure. Scenario packs include subject profile, oncology safety, vaccine reactogenicity, and chronic disease examples.

## Quick Start

```sh
npm ci
npm run doctor
npm run gate:bundle
```

For full local verification, install the required R/Rust/Playwright/Tauri prerequisites and run:

```sh
npm run verify
```

Useful development commands:

```sh
npm run validate:config
npm run validate:data
npm run smoke:multi-app
npm run export
npm run build:all
npm run verify:static
npm run verify:offline
npm run guard:phi
npm run audit:tauri-security
npm run clinical:cdisc-preflight
```

## CLI Examples

```sh
node scripts/harness.mjs list
node scripts/harness.mjs add-app subject-profile-copy --template subject-profile
node scripts/harness.mjs add-data-pack subject-profile-copy ./my-data-pack --id my-synthetic-pack-v1 --copy
node scripts/harness.mjs export-reports --app subject-profile-reference
node scripts/harness.mjs export-report-pdfs
node scripts/harness.mjs review-signoff --status pending-review --decision not-reviewed
node scripts/harness.mjs evidence-index
node scripts/harness.mjs package-template
node scripts/harness.mjs verify-release --release release/
```

Create a new harness project from this template:

```sh
npm run harness -- new ../my-shinylive-harness \
  --name my-shinylive-harness \
  --portal-title "My Shinylive Portal"
cd ../my-shinylive-harness
npm ci
npm run gate:bundle
```

## Release Paths

Phase 3 has three preflight modes:

- `phase3:preflight:info` reports readiness and missing credentials without failing solely because signing credentials are absent. `phase3:preflight` is kept as a backward-compatible alias for this informational mode.
- `phase3:preflight:strict` is the signed release preflight used by `gate:release`; missing signing or notarization inputs are blocking failures.
- `phase3:preflight:internal:*` is for unsigned internal candidates; it still requires local packaging tools, but does not require external signing credentials.

Unsigned internal candidate:

```sh
npm run build:release-local
npm run build:release-windows-local
npm run verify:release
```

Signed/notarized release candidate:

```sh
npm run phase3:preflight:strict
npm run gate:release
```

Apple Developer ID signing, notarization, Windows signing, GitHub Release publication, and clean-machine manual acceptance require credentials and operational approval.

Release checksums are authoritative in `release/SHA256SUMS`. Release notes should describe the package and point to `SHA256SUMS`; they should not be treated as the checksum source of record.

## Verification Gates

- `gate:bundle`: lightweight source/bundle gate for JS/TS, config, data, static, offline, PHI guard, and Tauri security checks.
- `verify`: heavier integrated gate including export, Rust tests, Playwright E2E, runtime integrity, screenshots, and external HTTP(S) request audit.
- `gate:internal-release`: unsigned internal candidate path with internal/external readiness evidence.
- `gate:release`: credential-backed final release gate; it uses strict Phase 3 preflight and is expected to fail when signing/notarization credentials are not configured.

## Evidence Outputs

Generated evidence can include:

- `reports/harness-config-validation.json`
- `reports/clinical-data-pack-validation.json`
- `reports/cdisc-bridge-preflight.json`
- `reports/static-verification.json`
- `reports/offline-verification.json`
- `reports/phi-pii-scan.json`
- `reports/tauri-security-audit.json`
- `reports/reproducibility.json`
- `reports/release-artifact-verification.json`
- `release/validation-pack.zip`
- `release/SHA256SUMS`

## Key Documentation

- [Clinical audience guide](docs/clinical-audience-guide.md)
- [Clinical use limitation](docs/clinical-use-limitation.md)
- [PHI/PII policy](docs/phi-pii-policy.md)
- [Security threat model](docs/security-threat-model.md)
- [Evidence guide for clinical reviewers](docs/evidence-guide-for-clinical-reviewers.md)
- [Evidence guide for QA](docs/evidence-guide-for-qa.md)
- [Release and source packaging](docs/release-and-source-packaging.md)
- [Template CLI](docs/template-cli.md)
- [Verification](docs/verification.md)

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
