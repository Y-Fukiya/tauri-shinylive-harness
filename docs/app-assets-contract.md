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
  ],
  "domProbes": [
    "#overview_lab_trend img",
    "#exposure_ae_timeline img",
    "#data_pack_hash_value[data-harness-status=\"resolved\"]"
  ],
  "dataPack": {
    "id": "clinical-demo-subject-profile-v1",
    "sha256": "<aggregate data pack sha256>",
    "fileCount": 8,
    "files": [
      {
        "path": "shinylive-src/subject-profile-reference/data/demographics.csv",
        "size": 901,
        "sha256": "<file sha256>"
      }
    ]
  }
}
```

The portal manifest references app paths from the localhost server root. At runtime, `/apps/subject-safety-mini/index.html` resolves to `http://127.0.0.1:<port>/apps/subject-safety-mini/index.html`.

`dataPack` is optional. When an app declares `data_pack` and `data_paths` in `harness.toml`, the harness computes file hashes from the source data and carries them into both `harness-app.json` and `dist/manifest.json`.

`domProbes` is optional. When present, Playwright E2E waits for those selectors inside the nested Shinylive app iframe after smoke text is visible. The Subject Profile reference app uses DOM probes for the lab trend, exposure/AE timeline, and resolved in-app data pack hash.

Clinical apps that declare a data pack should pass `node scripts/harness.mjs validate-data <app-id>`. The generated validation report and data dictionary become release evidence in `validation-pack.zip`.

For a real Shinylive export, keep the app under its own directory and ensure all webR, WASM, package, and data assets are local to the exported tree. Do not overwrite Shinylive's own `app.json`; the harness portal reads `harness-app.json` instead.

Runtime must not depend on external CDNs or package repositories. `node scripts/e2e-verify.mjs` fails if non-local HTTP(S) requests are observed.

By default, `scripts/export-shinylive.R` disables Shinylive's extra webR package download path with `wasm_packages = FALSE`. Apps that require additional R packages must opt in deliberately with `HARNESS_WASM_PACKAGES=true` and then commit or otherwise preserve the resulting local assets before release verification.

The current committed app is generated with `shinylive::export()` and includes local webR/WASM assets. It validates the key runtime path: local HTTP serving, COOP/COEP, WASM MIME, `R.wasm` loading, and minimal R execution.
