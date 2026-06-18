# Manual Clean macOS Checklist

Use this checklist for unsigned internal release candidates and for credential-backed release candidates after signing/notarization is configured.

## Release Context

- Version:
- Git tag:
- Git commit:
- Build machine:
- Tester:
- Test date:

## Install And Launch

- [ ] Verify `release/SHA256SUMS` against downloaded artifacts.
- [ ] Copy or install the app on a clean macOS account or clean macOS VM.
- [ ] Launch the app from Finder.
- [ ] Confirm the portal opens on `127.0.0.1`.
- [ ] Confirm `/__harness/health` reports `ok: true`.
- [ ] Confirm `/__harness/integrity` reports `ok: true`.
- [ ] Confirm Gatekeeper behavior is expected for the release type.

## Offline Runtime

- [ ] Quit the app completely.
- [ ] Disable network access.
- [ ] Relaunch the app.
- [ ] Confirm the portal loads.
- [ ] Confirm each configured app opens.
- [ ] Confirm configured smoke text appears for each app.
- [ ] Confirm SharedArrayBuffer and cross-origin isolation diagnostics are true.
- [ ] Confirm no CDN, GitHub, Posit CDN, r-universe, or other external network requests are observed.

## Evidence Review

- [ ] Review `release/validation-pack/evidence/static-verification.json`.
- [ ] Review `release/validation-pack/evidence/e2e-diagnostics.json`.
- [ ] Review `release/validation-pack/evidence/bundle-integrity.json`.
- [ ] Review `release/validation-pack/evidence/harness-config-validation.json`.
- [ ] Review clinical data validation and generated data dictionary.
- [ ] Review SBOM/license inventory.
- [ ] Complete reviewer sign-off in `release/validation-pack/validation-summary.md`.
