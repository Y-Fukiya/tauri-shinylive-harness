# Clinical Audience Guide

This harness is an Offline Clinical Review Sandbox for Shinylive/webR apps. It
is designed to help clinical, safety, data management, statistical programming,
QA, and technical teams evaluate workflows with synthetic data.

It is not a validated clinical system and must not be used for diagnosis,
treatment, patient management, live clinical trial operations, PHI/PII
processing, regulatory submission, Part 11 electronic records or signatures, or
GxP production use unless separately validated and approved by the responsible
organization.

| Audience | What To Evaluate |
| --- | --- |
| Medical Monitor / Clinician | Subject profile, AE context, lab abnormality, exposure history, timeline, and snapshot reports. |
| Safety Reviewer | AE severity, relatedness, seriousness, lab-linked AE context, dose modification, and safety review reports. |
| Data Manager | Required columns, missingness, visit references, controlled terms, timeline consistency, and query candidates. |
| Statistician / Programmer | Synthetic schema, data lineage, CDISC bridge awareness, and the boundary between demo data and analysis-ready data. |
| Clinical Ops / CRA | Offline distribution, site education, walkthrough scripts, and review procedure clarity. |
| QA / CSV | Evidence pack, hashes, reproducibility, release gates, manual checklists, and sign-off boundaries. |
| IT / Security | Loopback server, CSP, COOP/COEP/CORP, no external request evidence, and PHI/PII prohibition. |

## First Files To Open

1. `README.md`
2. `docs/clinical-use-limitation.md`
3. `docs/medical-monitor-quickstart.md`
4. `docs/demo-medical-monitor-10min.md`
5. `docs/evidence-guide-for-clinical-reviewers.md`
