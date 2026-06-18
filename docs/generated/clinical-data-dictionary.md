# Clinical Data Dictionary: clinical-demo-subject-profile-v1

Generated: 2026-06-18T05:28:00.736Z
Synthetic: true
Aggregate SHA-256: 7e90126cbf948183ca7dbf0f27ab640c001fe279da18ba19496986b8324f5ebe

## demographics

File: `shinylive-src/subject-profile-reference/data/demographics.csv`
Rows: 6

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 6 | 0 |
| site_id | yes | string | 6 | 0 |
| arm | yes | string | 6 | 0 |
| sex | yes | string | 6 | 0 |
| age | yes | integer | 6 | 0 |
| race | yes | string | 6 | 0 |
| ethnicity | yes | string | 6 | 0 |
| region | yes | string | 6 | 0 |
| baseline_weight_kg | no | number | 6 | 0 |
| baseline_bmi | no | number | 6 | 0 |
| consent_date | yes | date | 6 | 0 |
| first_dose_date | yes | date | 6 | 0 |
| last_contact_date | yes | date | 6 | 0 |
| study_status | yes | string | 6 | 0 |

## visits

File: `shinylive-src/subject-profile-reference/data/visits.csv`
Rows: 34

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 34 | 0 |
| visit | yes | string | 34 | 0 |
| visit_day | yes | integer | 34 | 0 |
| visit_date | yes | date | 34 | 0 |
| visit_status | yes | string | 34 | 0 |
| disposition | yes | string | 34 | 0 |

## labs

File: `shinylive-src/subject-profile-reference/data/labs.csv`
Rows: 31

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 31 | 0 |
| visit | yes | string | 31 | 0 |
| visit_day | yes | integer | 31 | 0 |
| lab_test | yes | string | 31 | 0 |
| lab_value | yes | number | 31 | 0 |
| unit | yes | string | 31 | 0 |
| low | yes | integer | 31 | 0 |
| high | yes | integer | 31 | 0 |
| flag | yes | string | 31 | 0 |

## vitals

File: `shinylive-src/subject-profile-reference/data/vitals.csv`
Rows: 19

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 19 | 0 |
| visit | yes | string | 19 | 0 |
| visit_day | yes | integer | 19 | 0 |
| systolic_bp | yes | integer | 19 | 0 |
| diastolic_bp | yes | integer | 19 | 0 |
| heart_rate | yes | integer | 19 | 0 |
| temperature_c | yes | number | 19 | 0 |
| weight_kg | yes | number | 19 | 0 |

## adverse_events

File: `shinylive-src/subject-profile-reference/data/adverse_events.csv`
Rows: 9

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 9 | 0 |
| ae_id | yes | string | 9 | 0 |
| ae_term | yes | string | 9 | 0 |
| system_organ_class | yes | string | 9 | 0 |
| start_day | yes | integer | 9 | 0 |
| end_day | yes | integer | 8 | 1 |
| severity | yes | string | 9 | 0 |
| serious | yes | boolean | 9 | 0 |
| related | yes | string | 9 | 0 |
| outcome | yes | string | 9 | 0 |

## concomitant_meds

File: `shinylive-src/subject-profile-reference/data/concomitant_meds.csv`
Rows: 8

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 8 | 0 |
| medication | yes | string | 8 | 0 |
| indication | yes | string | 8 | 0 |
| start_day | yes | integer | 8 | 0 |
| end_day | yes | integer | 4 | 4 |
| ongoing | yes | boolean | 8 | 0 |

## exposure

File: `shinylive-src/subject-profile-reference/data/exposure.csv`
Rows: 16

| Column | Required | Inferred Type | Non-blank | Missing |
| --- | --- | --- | ---: | ---: |
| subject_id | yes | string | 16 | 0 |
| cycle | yes | integer | 16 | 0 |
| start_day | yes | integer | 16 | 0 |
| end_day | yes | integer | 16 | 0 |
| dose_mg | yes | integer | 16 | 0 |
| dose_status | yes | string | 16 | 0 |
| dose_intensity_pct | yes | integer | 16 | 0 |
