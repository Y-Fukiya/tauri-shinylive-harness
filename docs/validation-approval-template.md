# Validation Approval Template

## Release

- Product:
- Version:
- Commit:
- Release candidate artifact:
- Build date:
- Reviewer:
- Approver:

## Automated Evidence

- `reports/harness-config-validation.json`
- `reports/static-verification.json`
- `reports/bundle-integrity.json`
- `reports/e2e-diagnostics.json`
- `reports/phase3-preflight.json`
- `dist/harness-bundle-manifest.json`
- `dist/checksums/SHA256SUMS`
- `release/SHA256SUMS`
- `release/validation-pack/evidence-index.json`
- `release/validation-pack/manual-clean-macos-checklist.md`

## Required Review

- App catalog matches intended release scope.
- Harness config validation has zero errors.
- Smoke text passes for every configured app.
- External request audit contains zero non-local HTTP(S) requests.
- Static bundle hashes, runtime bundle integrity, and release checksums match.
- SBOM/license inventory reviewed.
- Apple signing identity is expected for external release.
- Notarization and stapling are complete for external release.
- Offline launch procedure passes on a clean macOS machine.

## Decision

- Approval status:
- Conditions:
- Evidence location:
- Approver signature/date:
