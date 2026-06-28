# Localhost Security Threat Model

## Scope

This threat model covers the bundled desktop harness, its local static server,
the diagnostics portal, synthetic data packs, reports, manifests, and runtime
integrity endpoint.

## Assets

- bundled app assets
- synthetic data packs
- exported HTML and PDF reports
- app and portal manifests
- checksum files
- SBOM and license reports
- runtime integrity endpoint
- validation evidence pack

## Trust Assumptions

- The app runs on a user-owned endpoint.
- The harness bundles synthetic data only.
- No PHI or PII is bundled.
- The local server binds to `127.0.0.1`.
- The local server is for same-machine use, not remote multi-user access.
- Release artifacts are verified with checksums before use.

## Known Risks

- A same-machine local process may access localhost endpoints while the app is
  running.
- The portal uses WebAssembly and webR, which require browser features such as
  cross-origin isolation headers.
- The local endpoints do not implement user authentication.
- The harness is not a regulated electronic record or electronic signature
  system.
- If real clinical data are imported, the risk profile changes materially and
  this threat model no longer applies.

## Mitigations

- PHI/PII prohibition policy.
- Loopback-only binding.
- Ephemeral port selection.
- Static bundled assets only.
- Path traversal checks in the Rust server.
- CSP and cross-origin isolation headers for HTML.
- Runtime bundle integrity checks.
- Release checksum verification.
- Playwright E2E audit for unexpected external HTTP(S) requests.

## Out Of Scope

- Enterprise identity and access management.
- Multi-user authorization.
- Part 11 electronic signature controls.
- Production audit trail retention.
- Incident response and regulated system operations.
