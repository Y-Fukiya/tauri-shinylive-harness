# Release Template

## Summary

- Release:
- Commit:
- Harness version:
- App count:
- Channel: internal

## Required Artifacts

- macOS app archive
- `SHA256SUMS`
- `dist/harness-bundle-manifest.json`
- `dist/checksums/SHA256SUMS`
- `dist/reports/sbom.json`
- `dist/reports/licenses.md`
- `reports/static-verification.json`
- `reports/e2e-diagnostics.json`

## Verification

- `npm run verify`
- `npm run build:harness`
- Browser diagnostics show `Reported SAB = true`
- Every configured app smoke text is visible
- External request audit has zero entries
- Static asset hashes match `dist/harness-bundle-manifest.json`

## Phase 3 Signing Checklist

- Developer ID Application certificate installed
- Apple Team ID configured
- Notarization credentials configured
- Hardened runtime enabled
- App notarized and stapled
- Signed archive checksum regenerated after final packaging
