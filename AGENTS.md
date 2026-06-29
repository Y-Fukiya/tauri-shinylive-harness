# Agent Operating Guide

This repository is a reusable harness, not a one-off exported app. Keep changes config-driven and reproducible.

## Source Of Truth

- `harness.toml` is the source of truth for project identity, distribution settings, and the app catalog.
- `shinylive-src/*` contains editable Shinylive app sources.
- `data-packs/*` contains reusable synthetic clinical data packs.
- `apps/*`, `dist/*`, `reports/*`, and `release/*` are generated outputs. Prefer changing source/config and regenerating outputs.

## Required Checks

Run these before committing meaningful changes:

```sh
npm run validate:config
npm run validate:data
npm run smoke:multi-app
npm run verify
```

For release-candidate work, also run:

```sh
npm run build:release-local
npm run build:release-windows-local
```

## Data Pack Rules

- Synthetic clinical packs must validate against `schemas/clinical-data-pack.schema.json`.
- Use `npm run harness -- add-data-pack <app-id> <data-dir> --id <pack-id> --copy` when attaching a reusable pack so the pack is registered under `data-packs/<pack-id>`.
- Keep `data_pack`, `data_pack_source`, and `data_paths` aligned in `harness.toml`.
- Never introduce real patient data into this repository.

## Distribution Boundary

- Apple Developer ID signing, installer signing, notarization, stapling, and Windows code signing require real credentials and operational approval.
- Do not invent, echo, or commit secrets.
- Unsigned internal candidates are acceptable through `npm run build:release-local`.

## Editing Notes

- Keep CLI behavior in `scripts/harness.mjs` and reusable helpers in `scripts/harness-core.mjs`.
- If you update the harness config contract, update `schemas/harness.schema.json`, docs, and `npm run validate:config`.
- If generated artifacts change after verification, commit only the artifacts that are intentionally tracked by this repo.
