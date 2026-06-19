# Clinical Demo Data Pack

`clinical-demo-subject-profile-v1` is a fully synthetic 30-subject data pack for harness demos, report export, and verification. It is not derived from real subjects, must not be mixed with PHI, and is not for clinical decision making.

## Location

```text
shinylive-src/subject-profile-reference/data/
data-packs/clinical-demo-subject-profile-v1/
data-packs/clinical-demo-oncology-safety-v1/
data-packs/clinical-demo-vaccine-reactogenicity-v1/
data-packs/clinical-demo-chronic-disease-v1/
```

## Domains

- `demographics.csv`
- `visits.csv`
- `labs.csv`
- `vitals.csv`
- `adverse_events.csv`
- `concomitant_meds.csv`
- `exposure.csv`
- `clinical-demo-data-pack.json`

## Scenario Packs

The reusable registry includes scenario-oriented synthetic packs:

- `clinical-demo-subject-profile-v1`: 30 subjects for the reference app and report export demos.
- `clinical-demo-oncology-safety-v1`: oncology-style safety follow-up with lab abnormalities and dose modifications.
- `clinical-demo-vaccine-reactogenicity-v1`: vaccine-style reactogenicity and short-window safety events.
- `clinical-demo-chronic-disease-v1`: chronic-disease longitudinal exposure and safety follow-up.

Regenerate them with:

```sh
npm run generate:data-packs
```

## Traceability

The `subject-profile-reference` app declares:

```toml
data_pack = "clinical-demo-subject-profile-v1"
data_pack_source = "data-packs/clinical-demo-subject-profile-v1"
data_paths = ["..."]
```

During `npm run export`, the harness computes per-file SHA-256 hashes and an aggregate data pack hash from the materialized app data. The aggregate hash uses each file's logical path inside the pack, not the repository location, so registry copies and materialized app copies remain traceable to the same content identity. The app manifest also records the reusable `data_pack_source` registry path. Those values are written into:

- `apps/subject-profile-reference/harness-app.json`
- `dist/manifest.json`
- `release/validation-pack.zip` evidence after Phase 3 packaging
- `reports/exported/*` report evidence after `npm run export:reports`

`npm run validate:data` also writes:

- `reports/clinical-data-pack-validation.json`
- `docs/generated/clinical-data-dictionary.md`

The validator checks metadata, required columns, subject ID references, lab/vital visit references, key controlled terminology, visit dates, AE start/end days, medication intervals, exposure interval overlap, treatment-related AE exposure context, lab-linked AE support records, medication indication alignment, reviewer-friendly issue summaries, and the aggregate data pack hash.

## Reference Checks

`npm run verify` confirms:

- `Subject Profile Reference App` is visible.
- `SUBJ-001 AE count: 3` is visible.
- `#overview_lab_trend img` is visible.
- `#exposure_ae_timeline img` is visible.
- `#data_pack_hash_value[data-harness-status="resolved"]` is visible.
- `#snapshot_report_table table` is visible.
- `#safety_review_table table` is visible.
- `#listing_visits table` is visible.
- no external HTTP(S) requests are observed.

The Subject Profile app displays the resolved data pack hash from `/manifest.json`, so the visible profile can be traced back to the exact hashed data pack used for generation and verification.
