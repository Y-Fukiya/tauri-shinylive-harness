# Clinical Data Contract

The harness validates synthetic clinical data packs before export, verification, and release packaging.

Synthetic data packs are for technical evaluation and verification only. They are not for clinical decision making without organization-specific validation and approval.

This contract is intentionally a compact, non-CDISC demo schema. It is useful for exercising the harness, report export, and validation evidence flow, but it is not an SDTM/ADaM submission contract. If the harness is used in a regulated clinical workflow, replace or map these domains through an organization-approved CDISC/controlled terminology process.

## Files

Required metadata:

- `clinical-demo-data-pack.json`

Required domains:

- `demographics.csv`
- `visits.csv`
- `labs.csv`
- `vitals.csv`
- `adverse_events.csv`
- `concomitant_meds.csv`
- `exposure.csv`

The metadata contract is defined in:

```text
schemas/clinical-data-pack.schema.json
```

## Commands

Validate configured data packs:

```sh
npm run validate:data
```

Validate one configured app:

```sh
npm run harness -- validate-data subject-profile-reference
```

Attach and validate an external synthetic data pack:

```sh
npm run harness -- add-data-pack subject-profile-copy ./data-pack --id clinical-demo-copy-v1 --copy
```

Use `--copy` to register the reusable source pack under `data-packs/<pack-id>` and to materialize the same data into `shinylive-src/<app-id>/data` for Shinylive export.

## Checks

The validator checks:

- metadata fields: `id`, `version`, `synthetic`, `description`, `domains`, and `primarySubject`
- required columns for all required domains
- duplicate or blank demographics `subject_id`
- subject ID references from visits, labs, vitals, AEs, medications, and exposure
- visit-level references from labs and vitals to `visits.csv`
- controlled terminology for key demo fields such as AE severity, seriousness, relatedness, lab flags, visit status, and exposure dose status
- ISO dates for demographics and visits
- visit day numeric values
- AE start/end day ordering
- medication and exposure start/end day ordering
- exposure interval overlap by subject
- treatment-related AE consistency against active exposure records
- lab-linked AE terms, such as ALT increase, against nearby supporting lab records
- concomitant medication indications against same-subject AE terms for non-background indications
- per-file SHA-256 and aggregate data pack SHA-256
- reviewer-friendly issue summaries by severity, rule code, subject, and domain

The aggregate data pack hash is computed from each file's logical path inside the pack plus file size and SHA-256, so the same data pack produces the same aggregate hash whether it is stored under `data-packs/<id>/` or materialized into an app source directory.

## Outputs

```text
reports/clinical-data-pack-validation.json
docs/generated/clinical-data-dictionary.md
```

Those files are copied into `release/validation-pack.zip` during `npm run phase3:package`.

## CDISC Bridge

The synthetic schema can be explained through `docs/cdisc-mapping.md` and `mappings/cdisc-demo-mapping.json`. This bridge is descriptive and is not a submission-ready SDTM/ADaM mapping.
