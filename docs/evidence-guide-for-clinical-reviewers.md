# Evidence Guide For Clinical Reviewers

## What To Open First

1. `reports/evidence-index.html`
2. `reports/clinical-data-pack-validation.json`
3. `reports/cdisc-bridge-preflight.json`
4. `reports/exported/`
5. `reports/exported-pdf/`
6. `reports/e2e-diagnostics.json`

## What Each File Means

| Evidence | Meaning |
| --- | --- |
| `clinical-data-pack-validation.json` | Synthetic data consistency checks, subject references, visit references, controlled terms, and timeline checks. |
| `cdisc-bridge-preflight.json` | Synthetic-to-SDTM bridge coverage, non-submission-ready status, and external validation handoff status. |
| `report-export-manifest.json` | HTML report inventory with hashes. |
| `pdf-report-export-manifest.json` | Companion PDF report inventory with hashes. |
| `e2e-diagnostics.json` | Browser verification and unexpected external HTTP(S) request audit. |
| `review-signoff.json` | Demo review status marker, not a regulated electronic signature. |

## Review Principle

Use the evidence pack to understand what was checked for this synthetic demo.
Do not treat it as clinical validation approval for production use.
