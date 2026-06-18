# Verification Procedure

This procedure is generated from `harness.toml` and covers Phase 2 local verification.

## Commands

1. `npm ci`
2. `node scripts/harness.mjs export`
3. `node scripts/harness.mjs prepare`
4. `node scripts/harness.mjs verify-static`
5. `node scripts/e2e-verify.mjs`
6. `npm run tauri:build`

## Acceptance Criteria

- Portal manifest lists every app from `harness.toml`.
- COOP, COEP, CORP, Service-Worker-Allowed, and MIME headers pass for configured probes.
- The browser reports SharedArrayBuffer availability and cross-origin isolation.
- Each app exposes its configured smoke text in a same-origin iframe.
- E2E network audit observes no external HTTP(S) requests.
- `dist/harness-bundle-manifest.json` hashes match bundled files.
- `dist/checksums/SHA256SUMS` is generated.
- `dist/reports/sbom.json` and `dist/reports/licenses.md` are generated.

## Apps

| App | Kind | Smoke Text |
| --- | --- | --- |
| subject-safety-mini | shinylive-r | Subject Safety Mini Dashboard<br>R smoke result<br>SUBJ-001 |

