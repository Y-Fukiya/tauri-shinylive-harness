# CDISC Bridge For Clinical Users

The harness includes a descriptive synthetic-to-SDTM bridge so clinical and
technical teams can discuss how demo fields relate to familiar clinical data
standards.

## Currently Provided

- Synthetic clinical schema
- Synthetic-to-SDTM descriptive bridge
- Required column coverage
- Local controlled terminology visibility
- Controlled terminology metadata identifying the set as `local-demo` / `demo-subset`
- Pinnacle 21 handoff readiness field
- `submissionReady: false`

## Not Currently Provided

- Full SDTM IG validation
- Full ADaM derivation
- Define-XML generation
- Full CDISC Controlled Terminology package validation
- Embedded external validator execution
- Submission package creation

## External Validation Evidence

If Pinnacle 21 or another validator is run outside the harness, archive its
approved output with `npm run import:external-validation -- --type pinnacle21
--input ./p21-output --study STUDY001`.

## Safe Interpretation

A green CDISC bridge preflight means the demo bridge is internally consistent.
It does not mean the data are submission-ready.
