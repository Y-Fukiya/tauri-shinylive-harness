# Manual Clean Windows Checklist

Use this checklist for unsigned internal Windows release candidates and for credential-backed signed release candidates.

## Release Context

- Version:
- Git tag:
- Git commit:
- Build machine:
- Tester:
- Test date:

## Install And Launch

- [ ] Verify `release/SHA256SUMS` against downloaded artifacts.
- [ ] Open `release/validation-pack/release-smoke-test.md` and use it as the authoritative smoke procedure for this artifact set.
- [ ] Install the NSIS setup executable on a clean Windows account or VM.
- [ ] Launch the installed app from the Start menu.
- [ ] Confirm the portal opens on `127.0.0.1`.
- [ ] Confirm `/__harness/health` reports `ok: true`.
- [ ] Confirm `/__harness/integrity` reports `ok: true`.
- [ ] Confirm Windows Defender SmartScreen behavior is expected for the release type.
- [ ] Confirm the portal states the app is not for clinical decision making.

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
- [ ] Review `release/validation-pack/release-smoke-plan.json`.
- [ ] Review `release/validation-pack/evidence/tauri-security-audit.json`.
- [ ] Review `release/validation-pack/evidence/reproducibility.json`.
- [ ] Review clinical data validation and generated data dictionary.
- [ ] Review SBOM/license inventory.
- [ ] Review `reports/local-release-audit.json`.
- [ ] Confirm release notes and validation summary state not for clinical decision making.
- [ ] Complete reviewer sign-off in `release/validation-pack/validation-summary.md`.
## Platform Prerequisites

- Confirm the target Windows version is within the supported internal demo
  range for the selected Tauri/WebView stack.
- Confirm Microsoft Edge WebView2 Runtime is installed, or document the
  enterprise/offline installation path before distributing the candidate.
- Treat unsigned NSIS/MSI candidates as internal evaluation builds only.
- Signed installers require organization-approved Windows code-signing
  credentials and release approval.
