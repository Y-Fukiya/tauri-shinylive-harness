# Release And Source Packaging Boundary

The harness separates source templates from release candidates.

## Source Template

Use:

```sh
npm run package:source-template
```

This writes `reports/source-template-manifest.json`.

The source template includes source, configuration, schemas, docs, scripts,
synthetic data packs, and app sources.

The source template excludes:

- `apps/`
- `dist/`
- `reports/`
- `release/`
- `target/`
- `node_modules/`
- `.r-lib/`
- `.shinylive-cache/`

## Release Candidate

Use the existing release flow:

```sh
npm run build:release-local
npm run verify:release
```

Release candidates include built app assets, reports, release artifacts,
validation pack evidence, checksums, and platform-specific smoke-test material.

## Static Verification Boundary

`npm run verify:static` expects prepared `dist/` artifacts. If `dist/` is
missing, run:

```sh
npm run export
npm run build:all
npm run verify:static
```

## Strict Release Checks

Use:

```sh
npm run doctor:release
npm run audit:reproducibility:strict
```

These checks are intended for release candidates, not for a fresh source
checkout.
