# Release Template

## Summary

- Release:
- Commit:
- Harness version:
- App count:
- Channel: internal
- Clinical use limitation: not for clinical decision making

## Required Artifacts

- macOS app archive
- macOS pkg
- Windows NSIS setup executable
- optional Windows MSI
- `SHA256SUMS`
- `dist/harness-bundle-manifest.json`
- `dist/checksums/SHA256SUMS`
- `dist/reports/sbom.json`
- `dist/reports/licenses.md`
- `reports/harness-config-validation.json`
- `reports/static-verification.json`
- `reports/bundle-integrity.json`
- `reports/tauri-security-audit.json`
- `reports/reproducibility.json`
- `reports/e2e-diagnostics.json`
- `reports/clinical-data-pack-validation.json`
- `reports/screenshots/`
- `docs/generated/clinical-data-dictionary.md`
- `reports/phase3-preflight.json`
- `reports/local-release-audit.json`
- `reports/local-release-audit-<platform>.json`
- `release/validation-pack.zip`
- `release/validation-pack/evidence-index.json`
- `release/validation-pack/release-smoke-plan.json`
- `release/validation-pack/release-smoke-test.md`
- `release/validation-pack/evidence/tauri-security-audit.json`
- `release/validation-pack/evidence/reproducibility.json`
- `release/validation-pack/manual-clean-macos-checklist.md`
- `release/validation-pack/manual-clean-windows-checklist.md`

## Verification

- `npm run verify`
- `npm run phase3:preflight`
- `npm run tauri:build:app` or `npm run tauri:build:app:no-sign`
- `npm run phase3:package`
- `npm run tauri:build:windows` or `npm run tauri:build:windows:no-sign`
- `npm run phase3:package:windows`
- `npm run local:audit:macos`
- `npm run local:audit:windows`
- Browser diagnostics show `Reported SAB = true`
- Every configured app smoke text is visible
- Configured DOM probes are visible
- External request audit has zero entries
- Static asset hashes match `dist/harness-bundle-manifest.json`
- Runtime `/__harness/integrity` reports OK
- Tauri security audit has zero errors
- Reproducibility report records pinned runtime and lockfile hashes
- Harness config validation has zero errors
- Clinical data validation has zero errors
- Data dictionary generated for validated data packs
- Data pack hashes are present in app manifests for apps that declare `data_pack`
- Screenshot evidence is present for the portal and verified apps
- Release checksums match `release/SHA256SUMS`
- Release smoke plan matches the tested platform and app catalog
- `npm run verify:release` passes for the generated release directory
- Portal, release notes, and validation summary state not for clinical decision making

## Phase 3 Signing Checklist

### macOS

- Developer ID Application certificate installed
- Developer ID Installer certificate installed when publishing pkg
- Apple Team ID configured
- Notarization credentials configured
- Hardened runtime enabled
- App notarized and stapled
- Signed archive checksum regenerated after final packaging

### Windows

- Windows code-signing certificate or organization signing command configured
- Timestamp URL configured for signed external release
- Signed installer checksum regenerated after final packaging
- SmartScreen behavior reviewed for the release type

## Approval Checklist

- Validation pack reviewed
- Offline launch procedure completed on clean macOS
- Offline launch procedure completed on clean Windows
- Reviewer sign-off completed in validation summary
- Release notes reviewed
- Draft GitHub Release reviewed before publish
- Organization quality approval recorded
