# Clinical Data Dictionary: clinical-demo-chronic-disease-v1

Generated: 2026-06-18T12:45:20.073Z
Synthetic: true
Aggregate SHA-256: 48ece900d3d74525163badbdcdfb65fc24ca84556e76c6cbb85c1fb2129668d0

## demographics

File: `data-packs/clinical-demo-chronic-disease-v1/demographics.csv`
Rows: 34

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 34 | 0 |
| site_id | yes | string | 34 | 0 |
| arm | yes | string | 34 | 0 |
| sex | yes | string | 34 | 0 |
| age | yes | integer | 34 | 0 |
| race | yes | string | 34 | 0 |
| ethnicity | yes | string | 34 | 0 |
| region | yes | string | 34 | 0 |
| baseline_weight_kg | no | number | 34 | 0 |
| baseline_bmi | no | number | 34 | 0 |
| consent_date | yes | date | 34 | 0 |
| first_dose_date | yes | date | 34 | 0 |
| last_contact_date | yes | date | 34 | 0 |
| study_status | yes | string | 34 | 0 |

## visits

File: `data-packs/clinical-demo-chronic-disease-v1/visits.csv`
Rows: 199

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 199 | 0 |
| visit | yes | string | 199 | 0 |
| visit_day | yes | integer | 199 | 0 |
| visit_date | yes | date | 199 | 0 |
| visit_status | yes | string | 199 | 0 |
| disposition | yes | string | 199 | 0 |

## labs

File: `data-packs/clinical-demo-chronic-disease-v1/labs.csv`
Rows: 330

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 330 | 0 |
| visit | yes | string | 330 | 0 |
| visit_day | yes | integer | 330 | 0 |
| lab_test | yes | string | 330 | 0 |
| lab_value | yes | number | 330 | 0 |
| unit | yes | string | 330 | 0 |
| low | yes | number | 330 | 0 |
| high | yes | number | 330 | 0 |
| flag | yes | string | 330 | 0 |

## vitals

File: `data-packs/clinical-demo-chronic-disease-v1/vitals.csv`
Rows: 131

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 131 | 0 |
| visit | yes | string | 131 | 0 |
| visit_day | yes | integer | 131 | 0 |
| systolic_bp | yes | integer | 131 | 0 |
| diastolic_bp | yes | integer | 131 | 0 |
| heart_rate | yes | integer | 131 | 0 |
| temperature_c | yes | number | 131 | 0 |
| weight_kg | yes | number | 131 | 0 |

## adverse_events

File: `data-packs/clinical-demo-chronic-disease-v1/adverse_events.csv`
Rows: 56

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 56 | 0 |
| ae_id | yes | string | 56 | 0 |
| ae_term | yes | string | 56 | 0 |
| system_organ_class | yes | string | 56 | 0 |
| start_day | yes | integer | 56 | 0 |
| end_day | yes | integer | 56 | 0 |
| severity | yes | string | 56 | 0 |
| serious | yes | boolean | 56 | 0 |
| related | yes | string | 56 | 0 |
| outcome | yes | string | 56 | 0 |

## concomitant_meds

File: `data-packs/clinical-demo-chronic-disease-v1/concomitant_meds.csv`
Rows: 34

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 34 | 0 |
| medication | yes | string | 34 | 0 |
| indication | yes | string | 34 | 0 |
| start_day | yes | integer | 34 | 0 |
| end_day | yes | empty | 0 | 34 |
| ongoing | yes | boolean | 34 | 0 |

## exposure

File: `data-packs/clinical-demo-chronic-disease-v1/exposure.csv`
Rows: 97

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 97 | 0 |
| cycle | yes | integer | 97 | 0 |
| start_day | yes | integer | 97 | 0 |
| end_day | yes | integer | 97 | 0 |
| dose_mg | yes | integer | 97 | 0 |
| dose_status | yes | string | 97 | 0 |
| dose_intensity_pct | yes | integer | 97 | 0 |

