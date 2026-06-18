# App Assets Contract

Each harness app starts as a `[[apps]]` entry in `harness.toml`, is exported to
`apps/<app-id>/`, and is copied to `dist/apps/<app-id>/`.

Minimum files:

```text
apps/<app-id>/
  index.html
  harness-app.json
```

Recommended files:

```text
apps/<app-id>/
  index.html
  harness-app.json
  data/
  shinylive/
```

`harness-app.json` fields:

```json
{
  "id": "subject-safety-mini",
  "title": "Subject Safety Mini Dashboard",
  "path": "/apps/subject-safety-mini/index.html",
  "description": "Clinical smoke app for validating Shinylive/webR runtime requirements.",
  "kind": "shinylive-r",
  "offlineRequired": true,
  "source": "shinylive-src/subject-safety-mini",
  "output": "apps/subject-safety-mini",
  "smokeText": ["Subject Safety Mini Dashboard", "R smoke result", "SUBJ-001"],
  "headerProbes": [
    "/apps/subject-safety-mini/index.html",
    "/apps/subject-safety-mini/harness-boot.js",
    "/apps/subject-safety-mini/shinylive/webr/R.wasm"
  ]
}
```

The portal manifest references app paths from the localhost server root. At runtime, `/apps/subject-safety-mini/index.html` resolves to `http://127.0.0.1:<port>/apps/subject-safety-mini/index.html`.

For a real Shinylive export, keep the app under its own directory and ensure all webR, WASM, package, and data assets are local to the exported tree. Do not overwrite Shinylive's own `app.json`; the harness portal reads `harness-app.json` instead.

Runtime must not depend on external CDNs or package repositories. `node scripts/e2e-verify.mjs` fails if non-local HTTP(S) requests are observed.

The current committed app is generated with `shinylive::export()` and includes local webR/WASM assets. It validates the key runtime path: local HTTP serving, COOP/COEP, WASM MIME, `R.wasm` loading, and minimal R execution.
