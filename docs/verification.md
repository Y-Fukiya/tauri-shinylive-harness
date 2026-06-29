# Verification

## Phase 2 Local Verification

```sh
npm ci
npm run verify
```

`npm run verify` performs:

- `node scripts/harness.mjs validate-config`
- `node scripts/harness.mjs validate-data`
- `node scripts/harness.mjs export`
- Vite portal build
- `tsc --noEmit`
- Rust unit tests for the harness server
- static bundle/hash verification
- Playwright E2E verification

## Harness Config Validation

```sh
npm run validate:config
```

Expected:

- `schemas/harness.schema.json` records the normalized configuration contract.
- Project, distribution, Phase 3, app, probe, and data pack fields are present and well formed.
- Configured app source directories and `app.R` files exist.
- Configured data paths and `data_pack_source` directories exist.
- `reports/harness-config-validation.json` records errors and warnings.

To verify one app while still preparing the full portal manifest:

```sh
npm run harness -- verify --app subject-profile-reference
```

## Clinical Data Validation

```sh
npm run validate:data
```

Expected:

- `schemas/clinical-data-pack.schema.json` defines the metadata contract.
- Required columns are present for demographics, visits, labs, vitals, adverse events, concomitant meds, and exposure.
- Every non-demographics subject reference resolves to demographics.
- Visit dates, AE start/end days, medication days, and exposure intervals are valid.
- Cross-domain checks cover treatment-related AE exposure context, lab-linked AE support records, medication indication alignment, and overlapping exposure intervals.
- `summary` groups issues by severity, rule code, subject, and domain for reviewer scanning.
- `reports/clinical-data-pack-validation.json` records the validation result and aggregate data pack hash.
- `docs/generated/clinical-data-dictionary.md` records inferred column types and missingness.

## Static Verification

```sh
node scripts/harness.mjs verify-static
```

Expected:

- `dist/manifest.json` app count matches `harness.toml`.
- Every configured header probe exists.
- Every file in `dist/harness-bundle-manifest.json` exists.
- Every SHA-256 hash matches current bundled content.
- `reports/static-verification.json` is written.

## Runtime Bundle Integrity

```sh
node scripts/e2e-verify.mjs
```

Expected:

- `/__harness/integrity` reads `dist/harness-bundle-manifest.json`.
- Every listed bundled asset exists under the static root.
- Every asset size and SHA-256 matches the manifest.
- Static assets advertise byte range support and cache headers suitable for bundled webR assets.
- E2E requests a bundled `R.wasm` asset with `Range: bytes=0-15` and expects `206`, `Content-Range`, `Accept-Ranges: bytes`, and immutable cache headers.
- The diagnostics portal displays `Bundle Integrity`.
- `reports/bundle-integrity.json` is written.

## E2E Verification

```sh
node scripts/e2e-verify.mjs
```

Expected:

- A Rust localhost server starts against `dist/`.
- Portal diagnostics load.
- Runtime bundle integrity reports OK.
- Each configured app can be selected in the portal.
- Each app's configured smoke text is visible through the Shinylive iframe.
- Each configured DOM probe is visible through the Shinylive iframe.
- `subject-profile-reference` proves `SUBJ-001 AE count: 3`, `#overview_lab_trend img`, `#exposure_ae_timeline img`, and a resolved in-app data pack hash.
- Screenshot evidence is written under `reports/screenshots/`.
- No non-local HTTP(S) requests are observed.
- `reports/e2e-diagnostics.json` is written.

## Packaged macOS Build

```sh
npm run build:harness
```

Expected:

- Full Phase 2 verification passes.
- Tauri creates `src-tauri/target/release/bundle/macos/Clinical Shinylive Desktop Portal.app`.
- Launching the `.app` starts a `127.0.0.1` listener.
- `/__harness/health`, `/manifest.json`, app boot JS, and `R.wasm` are served from bundled resources.

## Packaged Windows Build

```sh
npm run tauri:build:windows:no-sign
npm run phase3:package:windows
```

Expected on Windows:

- Full Phase 2 verification passes.
- Tauri creates a Windows NSIS setup executable under `src-tauri/target/release/bundle/nsis/`.
- `phase3:package:windows` collects the configured installer artifacts, checksums, and validation pack into `release/`.
- Launching the installed app starts a `127.0.0.1` listener.
- `/__harness/health`, `/__harness/integrity`, `/manifest.json`, app boot JS, and `R.wasm` are served from bundled resources.

## Manual Offline Procedure

1. Run `npm run build:harness`.
2. Launch the packaged app once while online.
3. Fully quit the app.
4. Disconnect OS network.
5. Relaunch the packaged app.
6. Confirm the portal loads.
7. Confirm every configured app smoke text appears.
8. Confirm diagnostics report `Reported SAB = true`.
9. Confirm there are no requests to CDNs, GitHub, Netlify, Posit CDN, `repo.r-wasm.org`, or r-universe.

For Windows, use `docs/manual-clean-windows-checklist.md`.

## Phase 3 Release Candidate Verification

Informational preflight can be used to document missing credentials without treating that alone as a hard failure:

```sh
npm run phase3:preflight:info
```

Unsigned internal candidates should use the internal release gate. The gate runs
the unsigned platform build, Phase 3 packaging, artifact doctor checks,
`verify:release`, and the strict local release audit; do not run those steps as a
separate manual chain unless you are debugging a failed gate step.

```sh
npm run gate:internal-release
```

Set `HARNESS_TARGET_PLATFORM=macos` or `HARNESS_TARGET_PLATFORM=windows` when
you need to select the release gate target platform. This does not provide
cross-platform Tauri packaging by itself; run the gate on a matching macOS or
Windows runner unless you have explicitly configured cross-build tooling.
GitHub Actions uses the `Internal Candidate` workflow to run the same gate on
macOS and Windows runners.

Signed release candidates should use strict preflight through `gate:release`; missing signing or notarization credentials are expected to fail the gate:

```sh
npm run phase3:preflight:strict
npm run gate:release
```

Expected:

- `reports/phase3-preflight.json` is written.
- `reports/cdisc-bridge-preflight.json` is written with synthetic bridge coverage, controlled terminology gaps, Pinnacle 21 handoff readiness, and `submissionReady: false`.
- `reports/pdf-report-export-manifest.json` and `reports/exported-pdf/` are written from the latest HTML report export.
- `reports/review-signoff.json`, `reports/review-signoff-history.jsonl`, and `reports/evidence-index.html` are written for reviewer workflow evidence.
- Missing credentials are reported as readiness issues, not as leaked secret values.
- Tauri creates the macOS app and Windows NSIS installer, and Phase 3 packaging creates platform release evidence.
- `release/SHA256SUMS` covers every generated release file.
- `release/validation-pack/` and `release/validation-pack.zip` contain verification evidence, config validation, runtime integrity, data validation report, data dictionary, CDISC bridge preflight, HTML/PDF report evidence, review sign-off evidence, screenshots, manifest, SBOM/license inventory, platform manual clean checklist, release smoke test plan, and checksums.
- `reports/release-artifact-verification.json` confirms release checksums, `validation-pack.zip`, `release-smoke-plan.json`, and required evidence files.
- `reports/tauri-security-audit.json` records Tauri capability, CSP, navigation, resource, and localhost bind checks.
- `reports/reproducibility.json` records pinned Node, Rust, R, lockfile hashes, and bundled asset hashes.

With Apple credentials configured, replace `npm run tauri:build:app:no-sign` with:

```sh
npm run tauri:build:app
```

External release remains gated on successful notarization/stapling and organization approval.
Windows external release remains gated on code signing, SmartScreen expectations, clean Windows verification, and organization approval.
