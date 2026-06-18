# Clinical Data Contract

The harness validates synthetic clinical data packs before export, verification, and release packaging.

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
- ISO dates for demographics and visits
- visit day numeric values
- AE start/end day ordering
- medication and exposure start/end day ordering
- per-file SHA-256 and aggregate data pack SHA-256

## Outputs

```text
reports/clinical-data-pack-validation.json
docs/generated/clinical-data-dictionary.md
```

Those files are copied into `release/validation-pack.zip` during `npm run phase3:package`.
