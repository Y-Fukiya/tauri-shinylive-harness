# Clinical Data Dictionary: clinical-demo-subject-profile-v1

Generated: 2026-06-18T22:38:54.075Z
Synthetic: true
Aggregate SHA-256: de739a5dd93b8b84e5c9ff2a52e7e8f74a3df2d31828af7ec23ccd4e550c5dba

## demographics

File: `shinylive-src/subject-profile-reference/data/demographics.csv`
Logical path: `demographics.csv`
Rows: 30

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 30 | 0 |
| site_id | yes | string | 30 | 0 |
| arm | yes | string | 30 | 0 |
| sex | yes | string | 30 | 0 |
| age | yes | integer | 30 | 0 |
| race | yes | string | 30 | 0 |
| ethnicity | yes | string | 30 | 0 |
| region | yes | string | 30 | 0 |
| baseline_weight_kg | no | number | 30 | 0 |
| baseline_bmi | no | number | 30 | 0 |
| consent_date | yes | date | 30 | 0 |
| first_dose_date | yes | date | 30 | 0 |
| last_contact_date | yes | date | 30 | 0 |
| study_status | yes | string | 30 | 0 |

## visits

File: `shinylive-src/subject-profile-reference/data/visits.csv`
Logical path: `visits.csv`
Rows: 177

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 177 | 0 |
| visit | yes | string | 177 | 0 |
| visit_day | yes | integer | 177 | 0 |
| visit_date | yes | date | 177 | 0 |
| visit_status | yes | string | 177 | 0 |
| disposition | yes | string | 177 | 0 |

## labs

File: `shinylive-src/subject-profile-reference/data/labs.csv`
Logical path: `labs.csv`
Rows: 294

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 294 | 0 |
| visit | yes | string | 294 | 0 |
| visit_day | yes | integer | 294 | 0 |
| lab_test | yes | string | 294 | 0 |
| lab_value | yes | number | 294 | 0 |
| unit | yes | string | 294 | 0 |
| low | yes | number | 294 | 0 |
| high | yes | number | 294 | 0 |
| flag | yes | string | 294 | 0 |

## vitals

File: `shinylive-src/subject-profile-reference/data/vitals.csv`
Logical path: `vitals.csv`
Rows: 117

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 117 | 0 |
| visit | yes | string | 117 | 0 |
| visit_day | yes | integer | 117 | 0 |
| systolic_bp | yes | integer | 117 | 0 |
| diastolic_bp | yes | integer | 117 | 0 |
| heart_rate | yes | integer | 117 | 0 |
| temperature_c | yes | number | 117 | 0 |
| weight_kg | yes | number | 117 | 0 |

## adverse_events

File: `shinylive-src/subject-profile-reference/data/adverse_events.csv`
Logical path: `adverse_events.csv`
Rows: 49

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 49 | 0 |
| ae_id | yes | string | 49 | 0 |
| ae_term | yes | string | 49 | 0 |
| system_organ_class | yes | string | 49 | 0 |
| start_day | yes | integer | 49 | 0 |
| end_day | yes | integer | 49 | 0 |
| severity | yes | string | 49 | 0 |
| serious | yes | boolean | 49 | 0 |
| related | yes | string | 49 | 0 |
| outcome | yes | string | 49 | 0 |

## concomitant_meds

File: `shinylive-src/subject-profile-reference/data/concomitant_meds.csv`
Logical path: `concomitant_meds.csv`
Rows: 37

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 37 | 0 |
| medication | yes | string | 37 | 0 |
| indication | yes | string | 37 | 0 |
| start_day | yes | integer | 37 | 0 |
| end_day | yes | integer | 7 | 30 |
| ongoing | yes | boolean | 37 | 0 |

## exposure

File: `shinylive-src/subject-profile-reference/data/exposure.csv`
Logical path: `exposure.csv`
Rows: 87

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 87 | 0 |
| cycle | yes | integer | 87 | 0 |
| start_day | yes | integer | 87 | 0 |
| end_day | yes | integer | 87 | 0 |
| dose_mg | yes | integer | 87 | 0 |
| dose_status | yes | string | 87 | 0 |
| dose_intensity_pct | yes | integer | 87 | 0 |

