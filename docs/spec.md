# Phase 2 Spec: Tauri Shinylive Harness

## Goal

Turn the Spike/MVP into a reusable local-first template and CLI that can generate, verify, and package one or more bundled Shinylive/webR apps inside a Tauri desktop shell.

Phase 2 stops before production signing/notarization and organization-specific clinical validation approval.

## Decisions

- Source of truth: `harness.toml`.
- CLI: `node scripts/harness.mjs`.
- App catalog: `[[apps]]` entries in `harness.toml`.
- App metadata: each exported app writes `apps/<id>/harness-app.json`.
- Portal manifest: `dist/manifest.json`, generated from `harness.toml` and app manifests.
- Bundle integrity: `dist/harness-bundle-manifest.json` plus `dist/checksums/SHA256SUMS`.
- Verification: TypeScript check, Rust tests, static hash verification, and Playwright E2E.
- Network posture: E2E fails if non-local HTTP(S) requests are observed.
- Distribution proof: unsigned macOS `.app` build.
- Phase 3: Apple signing, notarization, release publication, and formal validation.

## CLI Commands

```text
harness new <directory>
harness add-app <id> [--title "Title"]
harness export [app-id]
harness prepare
harness verify-static
harness verify
harness build
```

`npm run verify` maps to `harness verify`.

`npm run build:harness` maps to `harness build`.

## Runtime Architecture

```text
Tauri app starts
  -> Rust setup resolves bundled dist/
  -> Rust loopback server binds 127.0.0.1:0
  -> main WebView navigates to http://127.0.0.1:<port>/portal/index.html
  -> portal fetches /manifest.json and /__harness/health
  -> user selects an app from the manifest
  -> portal displays selected /apps/<id>/index.html in a same-origin iframe
  -> Shinylive creates its own nested app iframe
  -> app posts diagnostics to parent/top windows
```

## Dist Layout

```text
dist/
  portal/
    index.html
    assets/
  manifest.json
  harness-bundle-manifest.json
  checksums/
    SHA256SUMS
  reports/
    sbom.json
    licenses.md
  apps/
    <app-id>/
      index.html
      app.json
      harness-app.json
      harness-boot.js
      shinylive/
```

## Required Response Headers

Every static response must include:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`
- `Service-Worker-Allowed: /`
- `X-Content-Type-Options: nosniff`

HTML responses must also include the harness CSP:

```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self' blob:;
connect-src 'self';
img-src 'self' data: blob:;
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
frame-src 'self';
object-src 'none';
base-uri 'self';
```

## Portal Requirements

The portal must show:

- App list from `dist/manifest.json`.
- App search and selection.
- Selected app URL and iframe loading state.
- Retry, same-window open, and diagnostics JSON download actions.
- Browser isolation, SharedArrayBuffer, ServiceWorker, and server health diagnostics.
- Header probes for portal HTML and selected app probes.
- iframe-reported diagnostics by app id.

## Server Requirements

The Rust server must:

- Bind only to `127.0.0.1`.
- Use an ephemeral port.
- Reject path traversal.
- Disable directory listing.
- Serve only files under the resolved asset root.
- Return required security headers and MIME types.
- Provide `GET /__harness/health`.
- Provide `GET /__harness/headers?path=/...`.

## Acceptance Criteria

- `npm run export` generates configured app output.
- `npm run build:all` creates portal, app dist, aggregated manifest, bundle manifest, checksums, SBOM seed, license report, and generated verification procedure.
- `npm run verify` passes TypeScript check, Rust tests, static hash verification, and Playwright E2E.
- Playwright E2E confirms smoke text for each configured app.
- Playwright E2E records zero external HTTP(S) requests.
- `npm run build:harness` produces the unsigned macOS `.app`.
- Packaged `.app` health endpoint serves `dist` from bundled resources.
