# CDISC Roadmap

## Current Layer

- Synthetic clinical schema
- Descriptive synthetic-to-SDTM mapping
- CDISC bridge preflight report
- Controlled terminology visibility
- Controlled terminology metadata with `notFullCdiscCtPackage: true`
- Pinnacle 21 handoff fields

## Next Practical Layer

- Import external validation outputs into evidence packs
- Record CT package version metadata
- Add explicit SDTM/ADaM/Define-XML roadmap docs
- Keep submission validation outside the demo harness unless separately
  licensed, configured, and approved

## Future Regulated Layer

If the project grows into regulated workflows, keep them separate:

```text
regulated/
  import/
  export/
  define-xml/
  external-validation/
  controlled-terminology/
  adam/
  sdtm/
```

The regulated layer should have its own requirements, SOP assumptions, test
strategy, validation plan, and approval process.
