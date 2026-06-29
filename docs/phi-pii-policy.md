# PHI / PII Policy

This repository and its bundled demo harness must not contain or process:

- real patient data
- protected health information
- personally identifiable information
- site-identifiable data
- investigator-identifiable confidential data
- sponsor confidential trial data unless separately approved
- live clinical trial operational data

The bundled data packs are synthetic only. Do not import live clinical trial
data into this demo harness.

## Rationale

The harness is intended for clinical review workflow prototyping, education,
offline demonstration, and validation evidence workflow evaluation. It does not
provide the access controls, audit-trail controls, retention controls,
electronic signature controls, organizational SOPs, or validated operational
procedures needed for regulated clinical production use.

## Required Handling

- Keep demo data synthetic.
- Remove any accidental PHI/PII immediately.
- Do not commit sponsor confidential clinical data.
- Do not use screenshots or exported reports that contain real patient data.
- Treat imported external validation evidence as confidential unless it is
  explicitly approved for sharing.
