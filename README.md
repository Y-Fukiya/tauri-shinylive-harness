**English** | [日本語](README.ja.md)

# Tauri Shinylive Harness

A reusable template for shipping bundled [Shinylive](https://shinylive.io/) / webR
apps inside a desktop shell. You write Shiny apps in R, the harness exports them to
static webR assets, serves them from an embedded localhost server inside a
[Tauri](https://tauri.app/) window, and produces validation/release evidence along
the way. Everything runs offline once exported.

> **Clinical use limitation.** This harness and its bundled synthetic demo apps are
> for technical evaluation only. They are not validated medical devices and are not
> for clinical decision making. The bundled demo data is synthetic and is **not** an
> SDTM/ADaM submission model. Map or replace the demo domains with your own validated
> CDISC/controlled-terminology workflow before using it for anything regulated, and
> never commit real patient data.

## What you get

- A diagnostics **portal** that lists configured apps and loads them in a same-origin iframe.
- An embedded **Rust localhost server** with COOP/COEP/CORP, CSP, byte-range serving, and a runtime bundle-integrity check.
- Two example R apps (`subject-safety-mini`, `subject-profile-reference`) and reusable synthetic **data packs**.
- A config-driven CLI for scaffolding apps, validating data, exporting, and packaging desktop builds.

## Prerequisites

| Tool | Used for | Notes |
| --- | --- | --- |
| Node.js 24 + npm | CLI, portal build, tests | version pinned in `.nvmrc` |
| Rust (stable, via rustup) | embedded server + Tauri shell | `rust-toolchain.toml` |
| R with `Rscript` | Shinylive export | first export installs the `shinylive` R package into `.r-lib` |
| Playwright Chromium | end-to-end verification | `npx playwright install chromium` |
| Tauri OS deps | desktop build | macOS: Xcode CLT · Windows: WebView2 + MSVC · Linux: webkit2gtk, librsvg |

The first export may need network access to download Shinylive/webR assets into
`.shinylive-cache`. After that the app runs fully offline.

## Quickstart

Start a new project from this template in one of two ways.

**A. GitHub "Use this template"** — click *Use this template* on the repo page, clone
your new repo, then:

```sh
npm ci
npm run export      # regenerate apps/ from shinylive-src/ (see note below)
npm run verify      # validate + build + test + e2e
npm run tauri:dev   # launch the desktop app
```

**B. Scaffold from the CLI** — from a checkout of this repo:

```sh
npm run harness -- new ../my-portal --name my-portal --portal-title "My Portal"
cd ../my-portal
npm ci
npm run verify
```

> **`apps/` is generated, not committed.** The exported webR runtime is large, so
> `apps/` is git-ignored. A fresh clone has no bundle until you run `npm run export`
> (or `npm run verify`, which exports first). This is expected.

## How the project is organized

The golden rule: **edit sources and config, then regenerate outputs.** Never hand-edit
generated directories.

| Path | Role | Edit it? |
| --- | --- | --- |
| `harness.toml` | source of truth: project identity, distribution, app catalog | Yes |
| `shinylive-src/<app>/` | editable Shiny app sources (`app.R`, `data/`) | Yes |
| `data-packs/<pack>/` | reusable synthetic data packs | Yes |
| `src/`, `src-tauri/`, `crates/` | portal UI, Tauri shell, Rust server | Yes |
| `templates/` | app/report templates used by `add-app --template` | Yes |
| `apps/`, `dist/`, `reports/`, `release/` | generated outputs | No — regenerate |

## Everyday development loop

Add an app (the `subject-profile` template wires up data, reports, and DOM probes):

```sh
npm run harness -- add-app lab-trends --title "Lab Trends" --template subject-profile
```

Attach a reusable synthetic data pack to an app:

```sh
npm run harness -- add-data-pack lab-trends ./my-data --id lab-trends-data-v1 --copy
```

Then validate, export, and run:

```sh
npm run validate:config     # check harness.toml against the schema
npm run validate:data       # check data packs (integrity, controlled terms, timelines)
npm run export              # build webR bundles for all apps
npm run dev                 # portal only, in a browser at 127.0.0.1:1420
npm run tauri:dev           # full desktop app
```

`npm run doctor` is a quick health check (prerequisites, config, templates, data
references) and is the fastest way to see what is missing.

## Command reference

Run the CLI via `npm run harness -- <command>` (or `node scripts/harness.mjs <command>`).

**Scaffold & data**

| Command | Purpose |
| --- | --- |
| `new <dir>` | scaffold a fresh harness project |
| `add-app <id> [--template subject-profile]` | add an app to the catalog |
| `add-data-pack <app> <dir> --id <pack> --copy` | register a synthetic data pack |
| `list` / `doctor` | list apps / run health checks |

**Validate, export, evidence**

| Command | Purpose |
| --- | --- |
| `validate-config` / `validate-data` | schema + data integrity checks |
| `export [app]` | build webR bundles |
| `export-reports` / `export-report-pdfs` | generate HTML/PDF report evidence |
| `cdisc-preflight` | check synthetic->SDTM bridge readiness (stays `submissionReady: false`) |
| `review-signoff` / `evidence-index` | persist review-workflow evidence |
| `verify` | run the full Phase 2 chain (validate -> export -> build -> tests -> e2e) |

**Package & release**

| Command | Purpose |
| --- | --- |
| `package-template` | cut a reusable starter from the current project |
| `prepare` / `build` | build portal + dist, then the Tauri app |
| `audit-tauri-security` / `reproducibility` | security + reproducibility evidence |
| `verify-release` | validate built release artifacts |

A handful of these also have npm aliases (`npm run validate:config`, `npm run verify`,
`npm run export`, ...); see `package.json` for the full list.

## Building and releasing

Credential-free local release candidates (unsigned):

```sh
npm run build:release-local          # macOS .app + evidence pack
npm run build:release-windows-local  # Windows installer + evidence pack
npm run verify:release
```

Signed builds (Apple Developer ID / notarization, Windows code signing) and public
GitHub Releases require credentials and are wired through the `phase3:*` scripts and
the `Release Candidate` workflow. See `docs/phase3-distribution.md`.

## Continuous integration

`.github/workflows/ci.yml` runs `doctor`, `smoke:multi-app`, and `verify` on macOS and
Windows. `verify` is heavy: it installs the `shinylive` R package, downloads webR
assets, compiles the Rust server, and runs Playwright. If CI is slow or flaky on a
fork, consider splitting a fast deterministic job (`npm ci` -> `validate:config` ->
`validate:data` -> `test:unit` -> `check` -> `cargo test`) from the heavy
export/e2e/Tauri job.

## Documentation

| Doc | Topic |
| --- | --- |
| `docs/spec.md` | architecture and contracts |
| `docs/quickstart.md` | extended setup walkthrough |
| `docs/template-cli.md` | full CLI reference |
| `docs/clinical-data-contract.md`, `docs/cdisc-mapping.md` | data contract & CDISC bridge |
| `docs/report-export.md` | report templates and evidence |
| `docs/phase3-distribution.md` | signing, notarization, release |
| `AGENTS.md` | conventions for automated contributors |

## License

MIT — see `LICENSE`. Bundled synthetic clinical demo data is not real patient data and
is provided only for technical evaluation and demonstration.
