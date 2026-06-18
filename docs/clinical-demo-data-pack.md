# Clinical Demo Data Pack

`clinical-demo-subject-profile-v1` is a fully synthetic data pack for harness demos and verification. It is not derived from real subjects and must not be mixed with PHI.

## Location

```text
shinylive-src/subject-profile-reference/data/
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

## Traceability

The `subject-profile-reference` app declares:

```toml
data_pack = "clinical-demo-subject-profile-v1"
data_paths = ["..."]
```

During `npm run export`, the harness computes per-file SHA-256 hashes and an aggregate data pack hash. Those values are written into:

- `apps/subject-profile-reference/harness-app.json`
- `dist/manifest.json`
- `release/validation-pack.zip` evidence after Phase 3 packaging

## Reference Checks

`npm run verify` confirms:

- `Subject Profile Reference App` is visible.
- `SUBJ-001 AE count: 3` is visible.
- `#overview_lab_trend img` is visible.
- no external HTTP(S) requests are observed.
