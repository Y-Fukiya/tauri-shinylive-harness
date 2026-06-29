# Sample Release Evidence

This page describes the shape of a generated validation pack without publishing a real signed release artifact.

Generate a local sample with:

```sh
npm run build:release-local
npm run verify:release
```

The resulting `release/validation-pack/` directory should contain:

| Path | Purpose |
| --- | --- |
| `validation-summary.md` | Human-readable release validation summary and reviewer sign-off fields. |
| `release-smoke-plan.json` | Machine-readable clean-machine smoke procedure for the exact artifact set. |
| `release-smoke-test.md` | Human-readable clean-machine smoke checklist. |
| `evidence-index.json` | Hash inventory for evidence files. |
| `evidence/harness-config-validation.json` | `harness.toml` validation evidence. |
| `evidence/static-verification.json` | Static bundle file and hash evidence. |
| `evidence/bundle-integrity.json` | Runtime `/__harness/integrity` evidence. |
| `evidence/e2e-diagnostics.json` | Portal/app E2E, screenshots, range/cache, and external request evidence. |
| `evidence/clinical-data-pack-validation.json` | Synthetic clinical data validation evidence with summaries. |
| `evidence/clinical-data-dictionary.md` | Generated data dictionary. |
| `evidence/cdisc-bridge-preflight.json` | Synthetic-to-SDTM bridge coverage and Pinnacle 21 handoff readiness with `submissionReady: false`. |
| `evidence/pdf-report-export-manifest.json` | Companion PDF report manifest. |
| `evidence/review-signoff.json` | Current persisted reviewer workflow state. |
| `evidence/review-signoff-history.jsonl` | Append-only reviewer workflow history. |
| `evidence/evidence-index.html` | Human-readable evidence index for reviewers. |
| `evidence/tauri-security-audit.json` | Tauri hardening audit for capabilities, CSP, navigation, resources, and localhost binding. |
| `evidence/reproducibility.json` | Runtime pins, observed tool versions, lockfile hashes, and bundled asset hashes. |
| `evidence/reports/` | Exported subject reports listed by `report-export-manifest.json`. |
| `evidence/reports-pdf/` | Companion PDF reports generated from HTML reports. |
| `evidence/screenshots/` | Playwright screenshots for portal and verified apps. |

External publication remains gated on:

- Apple Developer ID signing, notarization, and stapling for macOS
- Windows code signing and SmartScreen review for Windows
- clean-machine install verification
- organization-specific validation approval
