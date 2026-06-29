# Validation Approval Template

## Release

- Product:
- Version:
- Commit:
- Release candidate artifact:
- Build date:
- Reviewer:
- Approver:
- Clinical use limitation confirmed:

## Automated Evidence

- `reports/harness-config-validation.json`
- `reports/static-verification.json`
- `reports/bundle-integrity.json`
- `reports/e2e-diagnostics.json`
- `reports/cdisc-bridge-preflight.json`
- `reports/report-export-manifest.json`
- `reports/pdf-report-export-manifest.json`
- `reports/review-workflow.json`
- `reports/review-signoff.json`
- `reports/review-signoff-history.jsonl`
- `reports/evidence-index.html`
- `reports/exported/`
- `reports/exported-pdf/`
- `reports/phase3-preflight.json`
- `reports/local-release-audit.json`
- `reports/local-release-audit-<platform>.json`
- `dist/harness-bundle-manifest.json`
- `dist/checksums/SHA256SUMS`
- `release/SHA256SUMS`
- `release/validation-pack/evidence-index.json`
- `release/validation-pack/release-smoke-plan.json`
- `release/validation-pack/release-smoke-test.md`
- `release/validation-pack/evidence/tauri-security-audit.json`
- `release/validation-pack/evidence/reproducibility.json`
- `release/validation-pack/evidence/cdisc-bridge-preflight.json`
- `release/validation-pack/evidence/pdf-report-export-manifest.json`
- `release/validation-pack/evidence/review-signoff.json`
- `release/validation-pack/evidence/review-signoff-history.jsonl`
- `release/validation-pack/evidence/evidence-index.html`
- `release/validation-pack/evidence/reports/`
- `release/validation-pack/evidence/reports-pdf/`
- `release/validation-pack/manual-clean-macos-checklist.md`
- `release/validation-pack/manual-clean-windows-checklist.md`

## Required Review

- App catalog matches intended release scope.
- Harness config validation has zero errors.
- Smoke text passes for every configured app.
- Configured report exports are present and include data pack hash, generation timestamp, app version, clinical-use limitation, and reviewer sign-off fields.
- PDF companion reports are present when the validation pack is intended for demo or audit review.
- CDISC bridge preflight has zero errors and explicitly states `submissionReady: false` until a regulated CDISC layer is approved.
- Review workflow status, reviewer, reviewed_at, decision, and notes fields are present.
- Review sign-off state and JSONL history are present and match the approval decision.
- Human-readable evidence index is present and all required evidence is marked present.
- External request audit contains zero non-local HTTP(S) requests.
- Static bundle hashes, runtime bundle integrity, and release checksums match.
- Tauri security audit and reproducibility evidence have zero blocking issues.
- Release smoke plan is completed for the tested artifact set.
- SBOM/license inventory reviewed.
- Apple signing identity is expected for external macOS release.
- Notarization and stapling are complete for external macOS release.
- Windows code-signing identity or signing command is expected for external Windows release.
- Offline launch procedure passes on clean macOS and clean Windows machines.
- Portal, release notes, and validation summary state that the harness is not for clinical decision making.

## Decision

- Approval status:
- Conditions:
- Evidence location:
- Approver signature/date:
