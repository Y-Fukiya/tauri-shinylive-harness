# Verification

## Phase 2 Local Verification

```sh
npm ci
npm run verify
```

`npm run verify` performs:

- `node scripts/harness.mjs validate-data`
- `node scripts/harness.mjs export`
- Vite portal build
- `tsc --noEmit`
- Rust unit tests for the harness server
- static bundle/hash verification
- Playwright E2E verification

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

## E2E Verification

```sh
node scripts/e2e-verify.mjs
```

Expected:

- A Rust localhost server starts against `dist/`.
- Portal diagnostics load.
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

## Phase 3 Release Candidate Verification

```sh
npm run phase3:preflight
npm run tauri:build:app:no-sign
npm run phase3:package
```

Expected:

- `reports/phase3-preflight.json` is written.
- Missing credentials are reported as readiness issues, not as leaked secret values.
- Tauri creates the macOS app, and Phase 3 packaging creates the DMG/pkg for internal review.
- `release/SHA256SUMS` covers every generated release file.
- `release/validation-pack/` and `release/validation-pack.zip` contain verification evidence, data validation report, data dictionary, screenshots, manifest, SBOM/license inventory, and checksums.

With Apple credentials configured, replace `npm run tauri:build:app:no-sign` with:

```sh
npm run tauri:build:app
```

External release remains gated on successful notarization/stapling and organization approval.
