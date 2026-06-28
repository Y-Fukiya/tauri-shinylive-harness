# CDISC Bridge Preflight

Generated: 2026-06-28T12:53:32.504Z
Project: tauri-shinylive-harness 0.9.1
Mapping: `mappings/cdisc-demo-mapping.json`
Schema: `schemas/cdisc-mapping.schema.json`

## Status

- Preflight OK: yes
- Mode: demo
- Submission ready: no
- Target standard: SDTM bridge demo-subset-0.1
- Pinnacle 21 CLI configured: no

## Coverage

- Domains mapped: 7/7
- Required columns mapped: 58/58
- Local controlled terminology columns: 11
- Mapped controlled-term columns: 15

## Limitations

- Synthetic clinical schema is the source of truth for this demo harness.
- SDTM mapping is descriptive and requires formal review before regulated use.
- This preflight is not a CDISC validator and is not a replacement for P21, CORE, or sponsor validation processes.
- ADaM import/export is not implemented.
- define.xml generation is not implemented.
- External Pinnacle 21 validation is a handoff point, not an embedded validation result.

## Issues

| Severity | Code | Message |
| --- | --- | --- |
| warning | demo-bridge-not-submission-ready | This mapping is a synthetic-data bridge for demos and is not a submission-ready SDTM/ADaM implementation. |
| warning | define-xml-not-generated | define.xml generation is outside the current harness scope. |
| warning | adam-layer-not-generated | ADaM dataset import/export is outside the current harness scope. |
| warning | full-cdisc-ct-package-not-bundled | A full CDISC controlled terminology package is not bundled. |
| warning | controlled-term-not-localized | A mapped controlled term does not yet have a local codelist. |
| warning | controlled-term-not-localized | A mapped controlled term does not yet have a local codelist. |
| warning | controlled-term-not-localized | A mapped controlled term does not yet have a local codelist. |
| warning | controlled-term-not-localized | A mapped controlled term does not yet have a local codelist. |
| warning | controlled-term-not-localized | A mapped controlled term does not yet have a local codelist. |
| warning | controlled-term-not-localized | A mapped controlled term does not yet have a local codelist. |
| warning | controlled-term-not-localized | A mapped controlled term does not yet have a local codelist. |
| warning | controlled-term-not-localized | A mapped controlled term does not yet have a local codelist. |
| warning | local-ct-not-marked-controlled | A locally validated controlled term is not marked controlled-term in the CDISC bridge. |
| warning | local-ct-not-marked-controlled | A locally validated controlled term is not marked controlled-term in the CDISC bridge. |
| warning | local-ct-not-marked-controlled | A locally validated controlled term is not marked controlled-term in the CDISC bridge. |
| warning | local-ct-not-marked-controlled | A locally validated controlled term is not marked controlled-term in the CDISC bridge. |
| warning | pinnacle21-cli-not-configured | Pinnacle 21 CLI is not configured for handoff validation. |

