# External Validation Import

The harness does not embed external submission validators. It can archive
externally generated validation evidence for review.

Example:

```sh
npm run import:external-validation -- \
  --type pinnacle21 \
  --input ./p21-output \
  --study STUDY001
```

Generated outputs:

- `reports/external-validation/pinnacle21-summary.json`
- `reports/external-validation/pinnacle21-summary.md`
- `reports/external-validation/pinnacle21/<study>/`

Boundary:

- The harness stores and hashes external validation evidence.
- The harness does not certify that the external validation is complete.
- The responsible organization must review validator version, configuration,
  rules, inputs, outputs, and acceptance criteria.
