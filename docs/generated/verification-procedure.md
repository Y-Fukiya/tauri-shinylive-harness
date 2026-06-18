# Verification Procedure

This procedure is generated from `harness.toml` and covers Phase 2 verification plus Phase 3 release readiness.

## Phase 2 Commands

1. `npm ci`
2. `node scripts/harness.mjs export`
3. `node scripts/harness.mjs prepare`
4. `node scripts/harness.mjs verify-static`
5. `node scripts/e2e-verify.mjs`
6. `npm run tauri:build`

## Phase 3 Commands

1. `npm run phase3:preflight`
2. `npm run tauri:build:app:no-sign` for an unsigned internal release candidate.
3. `npm run tauri:build:app` after Apple signing and notarization credentials are configured.
4. `npm run phase3:package`
5. `npm run phase3:release-draft` after the release has been reviewed.

## Acceptance Criteria

- Portal manifest lists every app from `harness.toml`.
- COOP, COEP, CORP, Service-Worker-Allowed, and MIME headers pass for configured probes.
- The browser reports SharedArrayBuffer availability and cross-origin isolation.
- Each app exposes its configured smoke text in a same-origin iframe.
- E2E network audit observes no external HTTP(S) requests.
- `dist/harness-bundle-manifest.json` hashes match bundled files.
- `dist/checksums/SHA256SUMS` is generated.
- `dist/reports/sbom.json` and `dist/reports/licenses.md` are generated.
- `reports/phase3-preflight.json` records signing, notarization, GitHub, and tooling readiness.
- `release/` contains an app archive, optional DMG, release notes, checksums, and validation pack.
- Public release publication is held until Apple credentials and organization approval are present.

## Apps

| App | Kind | Smoke Text |
| --- | --- | --- |
| subject-safety-mini | shinylive-r | Subject Safety Mini Dashboard<br>R smoke result<br>SUBJ-001 |

