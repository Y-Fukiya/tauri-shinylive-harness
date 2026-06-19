# CDISC Bridge Mapping

This harness uses a compact synthetic clinical schema for demos and technical verification. It is not an SDTM/ADaM submission model.

The bridge mapping files make the relationship explicit without claiming full CDISC compliance:

- Schema: `schemas/cdisc-mapping.schema.json`
- Demo mapping: `mappings/cdisc-demo-mapping.json`
- Preflight report: `reports/cdisc-bridge-preflight.json`
- Generated summary: `docs/generated/cdisc-bridge-preflight.md`

## Intended Use

- Explain how synthetic demo columns relate to familiar SDTM domains.
- Support reviewer discussion before investing in a real CDISC import/export layer.
- Keep the current demo schema clearly separate from regulated submission data.

## Current Domain Bridge

| Synthetic domain | Bridge target | Notes |
| --- | --- | --- |
| `demographics` | `DM` | Direct subject, site, arm, age, sex, race, and reference date style mappings. |
| `visits` | `SV` | Visit label, day, date, and status bridge. |
| `labs` | `LB` | Lab test/value/unit/reference range bridge. |
| `vitals` | `VS` | Wide vitals rows would be normalized into one VS row per test. |
| `adverse_events` | `AE` | AE term, SOC, severity, seriousness, relatedness, and outcome bridge. |
| `concomitant_meds` | `CM` | Medication, indication, timing, and ongoing flag bridge. |
| `exposure` | `EX` | Dose interval, dose amount, status, and dose-intensity bridge. |

## Boundary

The bridge mapping is deliberately descriptive. It does not provide:

- full CDISC controlled terminology package validation
- define.xml generation
- SDTM IG conformance checks
- embedded Pinnacle 21 validation
- submission-ready derivations

Those belong in a separate regulated data import/export layer. The harness can host that layer later, but the current repository remains a synthetic clinical demo harness.

## Preflight

Run:

```sh
npm run clinical:cdisc-preflight
```

The preflight checks:

- every synthetic domain has a bridge target
- every required synthetic column is mapped or explicitly marked `not-mapped`
- local controlled terminology coverage is visible
- mapped controlled terms without local codelists are listed
- Pinnacle 21 handoff readiness is recorded through `PINNACLE21_CLI`, `P21_CLI`, and optional `PINNACLE21_CONFIG`

The report intentionally writes `submissionReady: false`. A green preflight means the demo bridge is internally consistent, not that the data are CDISC submission-ready.

To prepare for a regulated layer, add a separate importer/exporter that produces reviewed SDTM/ADaM packages, define.xml, controlled terminology packages, and external validation output. Those outputs can then be copied into the validation pack as organization-specific evidence.
