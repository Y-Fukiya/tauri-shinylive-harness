# Template And CLI

## CLI Surface

```text
harness new <directory>
harness add-app <id> [--template basic|subject-profile]
harness add-data-pack <app-id> <data-dir> [--id data-pack-id] [--copy]
harness validate-config
harness validate-data [app-id]
harness list
harness doctor
harness export [app-id]
harness prepare
harness verify-static
harness verify [--app app-id]
harness build
```

Inside this repository, use:

```sh
npm run harness -- <command>
```

When installed as a package, the binary name is:

```sh
tauri-shinylive-harness <command>
```

## Template Contract

`harness new` copies the reusable project skeleton and rewrites project-local identity:

- `package.json` name/version
- `harness.toml`
- `src-tauri/tauri.conf.json`
- generated project README
- sample `shinylive-src/subject-safety-mini/app.R`
- `AGENTS.md`
- `schemas/harness.schema.json`
- reusable `data-packs/*` registry assets

Generated projects intentionally do not copy `dist/`, `release/`, `reports/`, `node_modules/`, `.r-lib/`, or Tauri/Cargo target directories.

Generated projects include both `mac_bundles` and `windows_bundles` in `harness.toml`. The default Windows bundle is `nsis`; add `msi` only when the Windows build environment has the required MSI toolchain.

## Multi-App Contract

`harness add-app` is idempotent for source creation and strict for duplicate app ids. The portal and E2E verification read `harness.toml`, so adding more apps naturally expands the app list and the smoke-test loop.

The built-in app template registry currently includes:

- `basic`: a minimal Shinylive R smoke app.
- `subject-profile`: a synthetic subject profile app with subject selector, lab selector, AE summary, exposure/AE timeline, and data pack hash display.

Example:

```sh
npm run harness -- add-app subject-profile-copy \
  --title "Subject Profile Copy" \
  --template subject-profile
npm run harness -- validate-data subject-profile-copy
npm run harness -- verify --app subject-profile-copy
```

Use `npm run smoke:multi-app` in this repository to verify the reusable template path without committing generated assets.

## Data Pack And DOM Probe Contract

Apps can declare data pack traceability:

```toml
data_pack = "clinical-demo-subject-profile-v1"
data_pack_source = "data-packs/clinical-demo-subject-profile-v1"
data_paths = ["shinylive-src/subject-profile-reference/data/demographics.csv"]
```

During export, the harness writes a `dataPack` object into `harness-app.json` with per-file SHA-256 hashes, an aggregate pack hash, and the configured source registry path. `dist/manifest.json` carries the same object for portal diagnostics and validation evidence.

`harness validate-config` checks the normalized `harness.toml` contract and writes `reports/harness-config-validation.json`.

`harness validate-data` checks:

- metadata contract in `clinical-demo-data-pack.json`
- required columns for demographics, visits, labs, vitals, adverse events, concomitant meds, and exposure
- subject ID referential integrity
- date and study-day ordering checks for visits, AEs, meds, and exposure
- hash-linked `reports/clinical-data-pack-validation.json`
- generated `docs/generated/clinical-data-dictionary.md`

Attach an external synthetic pack to an app with:

```sh
npm run harness -- add-data-pack subject-profile-copy ./data-pack --id clinical-demo-copy-v1
```

Use `--copy` to register the pack under `data-packs/<pack-id>` and then materialize it into the app source:

```sh
npm run harness -- add-data-pack subject-profile-copy ./data-pack --id clinical-demo-copy-v1 --copy
```

Apps can also declare rendered UI probes:

```toml
dom_probes = [
  "#overview_lab_trend img",
  "#exposure_ae_timeline img",
  "#data_pack_hash_value[data-harness-status=\"resolved\"]"
]
```

`npm run verify` waits for those selectors inside the Shinylive app iframe, so reference apps can prove that a chart or other rendered element actually appeared.
