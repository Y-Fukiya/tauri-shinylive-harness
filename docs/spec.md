# MVP Spec: Tauri Shinylive Harness

## Goal

Build a Spike/MVP harness that proves a static Shinylive/webR app can run inside a packaged Tauri desktop app when served from an embedded loopback localhost static server with the browser security model webR expects.

The MVP is not a general app-generation platform yet. It is the foundation for a later reusable template/CLI.

## Decisions

- Deliverable: MVP harness first; reusable template/CLI later.
- App count: one minimal clinical smoke app.
- App theme: `Subject Safety Mini Dashboard`.
- Current app asset status: generated with `shinylive::export()` from `shinylive-src/subject-safety-mini`.
- Frontend: React/Vite diagnostics portal.
- Viewer: same-origin iframe first.
- Fallback: same-window navigation button in the portal.
- Server: Rust embedded loopback static server.
- Server framework: Axum.
- Port: ephemeral `127.0.0.1:0`.
- Tauri API usage: none from portal or app pages.
- Diagnostics: browser values plus server self-test endpoints.
- Report: browser Blob download as `harness-diagnostics.json`.
- Offline verification: manual procedure plus portal diagnostics for MVP.
- Required platform proof: macOS packaged build.
- Deferred platform proof: Windows WebView2 packaged build.

## Runtime Architecture

```text
Tauri app starts
  -> Rust setup binds 127.0.0.1:0
  -> static server serves bundled dist/
  -> main WebView navigates to http://127.0.0.1:<port>/portal/index.html
  -> portal fetches /manifest.json and /__harness/health
  -> portal displays /apps/subject-safety-mini/index.html in a same-origin iframe
  -> portal collects iframe diagnostics through same-origin access and postMessage
```

## Dist Layout

```text
dist/
  portal/
    index.html
    assets/
  manifest.json
  apps/
    subject-safety-mini/
      index.html
      app.json
      harness-app.json
      data/
```

If a real Shinylive export is available, it replaces the contents of `apps/subject-safety-mini/` while preserving `index.html` and Shinylive's own `app.json`. Harness portal metadata lives in `harness-app.json`.

## Required Response Headers

Every static response must include:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`
- `Service-Worker-Allowed: /`
- `X-Content-Type-Options: nosniff`

HTML responses must also include:

```text
Content-Security-Policy:
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

## Required MIME Types

- `.html` -> `text/html; charset=utf-8`
- `.js` -> `text/javascript; charset=utf-8`
- `.mjs` -> `text/javascript; charset=utf-8`
- `.css` -> `text/css; charset=utf-8`
- `.json` -> `application/json; charset=utf-8`
- `.wasm` -> `application/wasm`
- `.data` -> `application/octet-stream`
- `.rds` -> `application/octet-stream`
- `.tgz` -> `application/gzip`
- `.csv` -> `text/csv; charset=utf-8`

## Portal Requirements

The portal must show:

- Selected app URL.
- iframe loading state.
- Retry button.
- Same-window open button.
- Diagnostics JSON download button.
- `window.crossOriginIsolated`.
- `SharedArrayBuffer` availability.
- ServiceWorker availability and registration count.
- User agent.
- Server health endpoint result.
- Header self-test result for portal HTML, app HTML, and a WASM path.
- iframe-reported diagnostics when available.

## Server Requirements

The Rust server must:

- Bind only to `127.0.0.1`.
- Use an ephemeral port.
- Reject path traversal.
- Disable directory listing.
- Serve only files under the resolved asset root.
- Return required security headers.
- Return explicit MIME types.
- Provide `GET /__harness/health`.
- Provide `GET /__harness/headers?path=/...`.

## Acceptance Criteria

- `npm run build:all` creates `dist/portal`, `dist/manifest.json`, and `dist/apps/subject-safety-mini`.
- Rust tests cover MIME mapping, header generation, and path normalization.
- Tauri setup starts the embedded server and navigates the main window to localhost.
- The portal can fetch manifest and self-test endpoints without Tauri API calls.
- The app is displayed in a same-origin iframe.
- The included smoke app loads local Shinylive/webR runtime assets and executes minimal R code.
- The diagnostics report can be downloaded from the browser.
- macOS packaged build is attempted and documented.
- If actual Shinylive export cannot be generated in the environment, the drop-in contract and blocker are documented.
