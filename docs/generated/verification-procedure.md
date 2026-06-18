# Verification Procedure

This procedure is generated from `harness.toml` and covers Phase 2 verification plus Phase 3 release readiness.

## Phase 2 Commands

1. `npm ci`
2. `node scripts/harness.mjs validate-config`
3. `node scripts/harness.mjs validate-data`
4. `node scripts/harness.mjs export`
5. `node scripts/harness.mjs prepare`
6. `node scripts/harness.mjs verify-static`
7. `node scripts/e2e-verify.mjs`
8. `npm run tauri:build`

## Phase 3 Commands

1. `npm run phase3:preflight`
2. `npm run tauri:build:app:no-sign` for an unsigned internal release candidate.
3. `npm run tauri:build:app` after Apple signing and notarization credentials are configured.
4. `npm run phase3:package`
5. `npm run phase3:preflight:windows`
6. `npm run tauri:build:windows:no-sign` for an unsigned internal Windows release candidate.
7. `npm run tauri:build:windows` after Windows signing credentials or a signing command are configured.
8. `npm run phase3:package:windows`
9. `npm run phase3:release-draft` after the release has been reviewed.

## Acceptance Criteria

- Portal manifest lists every app from `harness.toml`.
- `reports/harness-config-validation.json` passes with zero errors.
- COOP, COEP, CORP, Service-Worker-Allowed, and MIME headers pass for configured probes.
- The browser reports SharedArrayBuffer availability and cross-origin isolation.
- Each app exposes its configured smoke text in a same-origin iframe.
- Configured DOM probes are visible, including lab trend and exposure/AE timeline plots.
- Clinical data pack validation passes with zero errors.
- `reports/clinical-data-pack-validation.json` and `docs/generated/clinical-data-dictionary.md` are generated.
- Playwright screenshot evidence is generated for the portal and verified apps.
- E2E network audit observes no external HTTP(S) requests.
- `dist/harness-bundle-manifest.json` hashes match bundled files.
- Runtime `/__harness/integrity` reports bundled asset hashes as OK.
- `dist/checksums/SHA256SUMS` is generated.
- `dist/reports/sbom.json` and `dist/reports/licenses.md` are generated.
- `reports/phase3-preflight.json` records signing, notarization, GitHub, and tooling readiness.
- `release/` contains platform release artifacts, release notes, checksums, and validation pack.
- Windows NSIS installer artifacts are generated on Windows when `windows_bundles` includes `nsis`.
- Public release publication is held until platform signing credentials and organization approval are present.

## Apps

| App | Kind | Data Pack | Smoke Text |
| --- | --- | --- | --- |
| subject-safety-mini | shinylive-r | n/a | Subject Safety Mini Dashboard<br>R smoke result<br>SUBJ-001 |
| subject-profile-reference | shinylive-r | clinical-demo-subject-profile-v1 | Subject Profile Reference App<br>SUBJ-001 AE count: 3<br>Data pack hash |

