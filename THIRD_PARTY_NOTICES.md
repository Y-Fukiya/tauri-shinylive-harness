# Third-Party Notices

This repository is a harness and demo template. It depends on third-party
software that is governed by each project's own license terms. This notice is
an orientation aid, not a substitute for reviewing the upstream licenses.

## Runtime And Application Framework

| Component | Purpose | License source |
| --- | --- | --- |
| Tauri | Desktop application shell and bundling | Tauri project license files |
| React | Portal user interface | React project license files |
| React DOM | Portal rendering | React project license files |
| Vite | Portal build tooling | Vite project license files |
| lucide-react | Portal icons | Lucide project license files |

## Test And Verification Tooling

| Component | Purpose | License source |
| --- | --- | --- |
| Playwright | Browser-based E2E verification | Playwright project license files |
| TypeScript | Type checking | TypeScript project license files |
| Rust toolchain and crates | Local static server and Tauri build chain | Rust and crate license files |

## Shinylive / webR / R

| Component | Purpose | License source |
| --- | --- | --- |
| Shinylive | Static Shiny application runtime | Shinylive project license files |
| webR | R runtime in WebAssembly | webR project license files |
| R | R language runtime used during export | R project license files |
| Demo R packages | Packages used by bundled synthetic demo apps | Installed package license metadata |

## Generated Evidence

The harness generates SBOM and license inventory evidence during `prepare`.
Review `dist/reports/sbom.json` and `dist/reports/licenses.md` for the exact
dependencies included in a generated bundle.
