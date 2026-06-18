# Verification

## Local Build

```sh
npm install
npm run build:all
npm run test:rust
npm run verify
```

## Tauri Dev

```sh
npm run tauri:dev
```

Expected:

- Main window opens after Rust setup starts the localhost server.
- URL is `http://127.0.0.1:<ephemeral-port>/portal/index.html`.
- Portal diagnostics can fetch `/manifest.json`, `/__harness/health`, and `/__harness/headers`.
- App iframe loads `/apps/subject-safety-mini/index.html`.
- The iframe runtime log reaches `webR initialized` and reports R smoke result `2`.

## Packaged macOS Build

```sh
npm run tauri:build
```

Expected:

- Packaged app launches.
- Server logs show a `127.0.0.1` listener.
- Portal loads from localhost.
- Same diagnostics are available as dev.

The MVP build target is the macOS `.app` bundle. DMG creation is intentionally not part of the MVP acceptance target.

## Manual Offline Procedure

1. Run `npm run build:all`.
2. Run `npm run tauri:build`.
3. Launch the packaged app once while online.
4. Fully quit the app.
5. Disconnect OS network.
6. Relaunch the packaged app.
7. Confirm the portal loads.
8. Confirm the app iframe loads.
9. Confirm the app iframe runs local webR and reports R smoke result `2`.
10. Confirm diagnostics report no external runtime requirement.
11. In DevTools Network, confirm there are no requests to CDNs, GitHub, Netlify, Posit CDN, `repo.r-wasm.org`, or r-universe.

## Deferred Automated Checks

- Browser-level network audit.
- Windows WebView2 packaged build.
- custom protocol spike.
- separate WebView window fallback.
