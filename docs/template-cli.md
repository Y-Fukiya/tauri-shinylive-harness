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
harness export-reports [--app app-id] [--subject subject-id] [--all-subjects]
harness export-report-pdfs [--manifest reports/report-export-manifest.json]
harness cdisc-preflight [--pinnacle21-cli path]
harness review-signoff [--status pending-review] [--reviewer name] [--decision decision]
harness evidence-index
harness package-template [--output dist/starter-template] [--zip]
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

During export, the harness writes a `dataPack` object into `harness-app.json` with per-file SHA-256 hashes, logical pack-relative paths, an aggregate pack hash, and the configured source registry path. `dist/manifest.json` carries the same object for portal diagnostics and validation evidence.

`harness validate-config` checks the normalized `harness.toml` contract and writes `reports/harness-config-validation.json`.

`harness validate-data` checks:

- metadata contract in `clinical-demo-data-pack.json`
- required columns for demographics, visits, labs, vitals, adverse events, concomitant meds, and exposure
- subject ID and lab/vital visit-level referential integrity
- key controlled terminology for demo clinical fields
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

## Report Template Contract

Apps can declare report templates in `harness.toml`:

```toml
report_templates = ["subject-snapshot", "safety-review", "data-listing"]
```

Templates are registered under `templates/reports/<template-id>/template.json`.
The `export-reports` command renders configured HTML reports to `reports/exported/<app-id>/`.
The `export-report-pdfs` command renders companion PDFs to `reports/exported-pdf/<app-id>/`.

```sh
npm run harness -- export-reports --app subject-profile-reference
npm run harness -- export-reports --app subject-profile-reference --all-subjects
npm run harness -- export-report-pdfs
```

Generated reports include:

- app version
- subject ID
- data pack ID and aggregate SHA-256
- generation timestamp
- clinical-use limitation
- reviewer sign-off fields

`npm run verify` runs report export automatically so Phase 3 packaging can include the latest report evidence.

## Clinical Bridge And Review Workflow

The synthetic schema can be checked against the demo CDISC bridge mapping:

```sh
npm run harness -- cdisc-preflight
```

This writes `reports/cdisc-bridge-preflight.json` and `docs/generated/cdisc-bridge-preflight.md`. The command checks bridge coverage and Pinnacle 21 handoff readiness, but it keeps `submissionReady: false` because the harness does not generate regulated SDTM/ADaM packages.

Reviewer workflow state can be persisted separately from the report HTML:

```sh
npm run harness -- review-signoff \
  --status pending-review \
  --reviewer "Reviewer Name" \
  --decision not-reviewed \
  --notes "Initial validation packet generated"
npm run harness -- evidence-index
```

Outputs:

- `reports/review-signoff.json`
- `reports/review-signoff-history.jsonl`
- `reports/evidence-index.json`
- `reports/evidence-index.html`
- `docs/generated/evidence-index.md`

## Starter Template Packaging

Use `package-template` to cut a reusable starter artifact without generated app, dist, report, release, or build output:

```sh
npm run harness -- package-template
npm run harness -- package-template --zip
```

Outputs:

- `dist/starter-template/<artifact-name>-starter/`
- `reports/template-package-manifest.json`
- optional `dist/starter-template/<artifact-name>-starter.zip`

The starter is package-shaped and includes the `tauri-shinylive-harness` bin entry, but publishing to npm is intentionally separate because it requires package naming, ownership, release policy, and credentials.
