# Tauri Shinylive Harness

MVP harness for running a pre-exported Shinylive/webR app inside a Tauri desktop shell.

The first milestone is intentionally narrow:

- Tauri starts an embedded Rust loopback static server.
- The main WebView navigates to `http://127.0.0.1:<ephemeral-port>/portal/index.html`.
- The portal loads one clinical smoke app in a same-origin iframe.
- The included smoke app is generated with `shinylive::export()` and runs from bundled local assets.
- Security, MIME, isolation, ServiceWorker, and app-loading diagnostics are visible in the portal.
- The packaged macOS app is the first required platform proof. Windows WebView2 remains a follow-up acceptance target.

## Commands

```sh
npm install
npm run build:all
npm run test:rust
npm run verify
npm run tauri:dev
npm run tauri:build
```

## Current Scope

The harness is designed so that a future CLI/template can add apps, regenerate manifests, run verification, and package releases. For the MVP, app generation is not the core problem; the app directory is a drop-in static asset contract. `scripts/export-shinylive.R` records the repeatable export path.

See:

- `docs/spec.md`
- `docs/adr/0001-localhost-static-server.md`
- `docs/verification.md`
- `docs/app-assets-contract.md`
