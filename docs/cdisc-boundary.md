# CDISC Boundary

This repository should describe its current CDISC capability as "CDISC bridge
awareness", not "CDISC submission readiness".

## Boundary

The current harness:

- uses synthetic data
- maps synthetic fields to familiar SDTM-style targets
- reports bridge coverage
- reports controlled terminology gaps
- records external validation handoff readiness

The current harness does not:

- generate regulated SDTM packages
- generate regulated ADaM packages
- generate define.xml
- validate against a complete CDISC CT package
- execute or embed external submission validators by default
- create a regulatory submission package

## Recommended Language

Use:

- descriptive CDISC bridge
- synthetic-to-SDTM bridge
- CDISC bridge awareness
- external validation handoff readiness

Avoid:

- CDISC submission-ready
- regulatory-ready clinical application
- validated clinical system
- GxP validated
