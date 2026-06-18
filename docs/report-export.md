# Report Export

`export-reports` turns configured app report templates into review-ready HTML evidence.

## Configuration

Report templates are declared per app in `harness.toml`:

```toml
report_templates = ["subject-snapshot", "safety-review", "data-listing"]
```

Template metadata lives under `templates/reports/<template-id>/template.json`.

## Commands

```sh
npm run export:reports
npm run harness -- export-reports --app subject-profile-reference
npm run harness -- export-reports --app subject-profile-reference --subject SUBJ-001
npm run harness -- export-reports --app subject-profile-reference --all-subjects
```

Generated outputs:

- `reports/exported/index.html`
- `reports/exported/<app-id>/<subject-id>/<report>.html`
- `reports/report-export-manifest.json`
- `reports/review-workflow.json`
- `docs/generated/report-export-index.md`

## Evidence Content

Each exported report includes:

- app ID and app version
- subject ID
- data pack ID and aggregate SHA-256
- generation timestamp
- clinical-use limitation
- reviewer sign-off fields

Phase 3 packaging copies these outputs into `release/validation-pack/evidence/reports/`.
