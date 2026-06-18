# Release Template

## Summary

- Release:
- Commit:
- Harness version:
- App count:
- Channel: internal

## Required Artifacts

- macOS app archive
- macOS pkg
- `SHA256SUMS`
- `dist/harness-bundle-manifest.json`
- `dist/checksums/SHA256SUMS`
- `dist/reports/sbom.json`
- `dist/reports/licenses.md`
- `reports/static-verification.json`
- `reports/e2e-diagnostics.json`
- `reports/phase3-preflight.json`
- `release/validation-pack.zip`
- `release/validation-pack/evidence-index.json`

## Verification

- `npm run verify`
- `npm run phase3:preflight`
- `npm run tauri:build:dmg` or `npm run tauri:build:dmg:no-sign`
- `npm run phase3:package`
- Browser diagnostics show `Reported SAB = true`
- Every configured app smoke text is visible
- External request audit has zero entries
- Static asset hashes match `dist/harness-bundle-manifest.json`
- Release checksums match `release/SHA256SUMS`

## Phase 3 Signing Checklist

- Developer ID Application certificate installed
- Developer ID Installer certificate installed when publishing pkg
- Apple Team ID configured
- Notarization credentials configured
- Hardened runtime enabled
- App notarized and stapled
- Signed archive checksum regenerated after final packaging

## Approval Checklist

- Validation pack reviewed
- Offline launch procedure completed on clean macOS
- Release notes reviewed
- Draft GitHub Release reviewed before publish
- Organization quality approval recorded
