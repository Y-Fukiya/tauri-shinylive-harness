# Template And CLI

## CLI Surface

```text
harness new <directory>
harness add-app <id>
harness list
harness doctor
harness export [app-id]
harness prepare
harness verify-static
harness verify
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

Generated projects intentionally do not copy `dist/`, `release/`, `reports/`, `node_modules/`, `.r-lib/`, or Tauri/Cargo target directories.

## Multi-App Contract

`harness add-app` is idempotent for source creation and strict for duplicate app ids. The portal and E2E verification read `harness.toml`, so adding more apps naturally expands the app list and the smoke-test loop.

Use `npm run smoke:multi-app` in this repository to verify the reusable template path without committing generated assets.
