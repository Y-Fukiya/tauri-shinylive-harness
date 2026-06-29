# ADR 0001: Use an Embedded Localhost Static Server

## Status

Accepted for MVP.

## Context

Shinylive apps run Shiny in the browser through webR and WebAssembly. webR can use a `SharedArrayBuffer` channel when the page is cross-origin isolated, and otherwise may fall back to alternate communication with limitations. This makes the HTTP delivery model part of the runtime, not merely a packaging detail.

Tauri can display bundled assets or custom protocols, but the MVP needs direct control over:

- COOP / COEP / CORP headers.
- CSP.
- ServiceWorker scope.
- WASM MIME type.
- Same-origin iframe behavior.
- Offline packaged assets.

## Decision

The MVP uses an embedded Rust localhost static server as the primary runtime path.

The server binds to `127.0.0.1:0`, serves the packaged `dist/` tree, and applies explicit security headers and MIME types. Tauri setup navigates the main window to `http://127.0.0.1:<port>/portal/index.html`.

The portal and Shinylive app are served from the same origin. The first AppViewer implementation is a same-origin iframe. The portal and iframe do not call Tauri privileged APIs.

## Consequences

Benefits:

- The harness models the browser security requirements webR expects.
- Header and MIME behavior can be self-tested.
- The same server can later support app catalog and CLI-generated manifests.
- Remote capability risks are avoided in the MVP.

Costs:

- Tauri setup must manage server lifetime and navigation.
- Packaged resource path resolution must work in dev and bundled builds.
- Offline validation still needs manual OS-level network testing in the MVP.

## Alternatives Considered

### Tauri bundled asset / custom protocol first

Rejected as the primary MVP route. It may work in some environments, but ServiceWorker support, MIME handling, iframe isolation, and WebView differences are higher risk. It remains a later spike.

### Tauri localhost plugin

Rejected as primary for MVP. It may be useful if it can guarantee the required headers, MIME, loopback binding, and packaged behavior. The custom Rust server is more explicit for the first proof.

### Same-window navigation first

Deferred to fallback. Same-origin iframe gives a tighter diagnostics loop in the MVP.

## Follow-up

- Verify packaged Windows WebView2 behavior.
- Add automated network request audit.
- Decide whether a future CLI should regenerate `manifest.json`, export Shinylive apps, or both.
