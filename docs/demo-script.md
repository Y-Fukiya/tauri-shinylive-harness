# 10 Minute Demo Script

Use this flow when showing the harness to a technical, clinical operations, or validation audience.

## 0:00-1:00 Context

- Open the desktop portal or local dev portal.
- State the boundary: synthetic demo data only, not for clinical decision making.
- Point out the local-first architecture: Tauri shell, localhost server, bundled Shinylive/webR assets.

## 1:00-3:00 Portal Diagnostics

- Show the Diagnostics panel.
- Confirm SharedArrayBuffer and cross-origin isolation are true.
- Open `/__harness/health` and `/__harness/integrity`.
- Mention that E2E verification checks for zero external HTTP(S) requests.

## 3:00-5:30 Subject Profile App

- Select `Subject Profile Reference App`.
- Show `SUBJ-001`.
- Move through Overview, Timeline, Labs, AEs, Meds, and Reports.
- Highlight the data pack hash displayed in the app.

## 5:30-7:00 Reports

- Open the exported Subject Snapshot, Safety Review, and Data Listing reports.
- Point out generated timestamp, app version, data pack hash, clinical-use limitation, and reviewer sign-off fields.

## 7:00-8:30 Validation Evidence

- Open `reports/clinical-data-pack-validation.json`.
- Show zero errors and the issue summary structure.
- Open `reports/tauri-security-audit.json`, `reports/reproducibility.json`, and `reports/e2e-diagnostics.json`.

## 8:30-10:00 Release Pack

- Show `release/SHA256SUMS`.
- Open `release/validation-pack/release-smoke-test.md`.
- Show `release/validation-pack/evidence-index.json`.
- Explain that signing, notarization, and organization approval are the remaining external gates for production release.

## Closing Line

This is a reusable offline desktop harness for bundled Shinylive apps, with diagnostics, synthetic clinical demo data, exported reports, and release evidence generated from the same source of truth.
