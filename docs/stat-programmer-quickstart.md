# Statistical Programmer Quickstart

## Goal

Evaluate the technical data lineage and CDISC bridge awareness without treating
the synthetic schema as submission-ready SDTM or ADaM.

## Try This

1. Open `mappings/cdisc-demo-mapping.json`.
2. Run or review `reports/cdisc-bridge-preflight.json`.
3. Confirm `submissionReady: false`.
4. Review required column bridge coverage.
5. Review controlled terminology gaps.
6. Review data pack hashes in app manifests and exported reports.

## Evaluate

- Is the synthetic schema understandable?
- Is the SDTM bridge useful as a discussion artifact?
- Are not-mapped fields explicit?
- Is it clear that ADaM, define.xml, full CT validation, and submission package creation are outside the current harness?
