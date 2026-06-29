# Data Handling Boundary

## Allowed

- Synthetic clinical data packs under `data-packs/*`
- Synthetic Shinylive app source data under `shinylive-src/*/data`
- Generated validation evidence derived from synthetic data
- Local release evidence created from the bundled synthetic demo apps
- External validation summaries that have been explicitly approved for use in
  this repository

## Not Allowed

- Real patient data
- PHI or PII
- Site-identifiable or investigator-identifiable confidential data
- Sponsor confidential trial data unless separately approved
- Production EDC, SDTM, ADaM, listing, or safety data
- Screenshots, PDFs, or reports containing real subject information

## Boundary Statement

This harness is an offline clinical review sandbox. It can help teams evaluate
review workflows, reports, validation evidence generation, and app packaging
with synthetic data. It is not a production clinical data repository and is not
a regulated system of record.
