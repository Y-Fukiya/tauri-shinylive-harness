# 臨床レビュー・教育・PoC 向けオフライン Shinylive/webR デスクトップ Sandbox

このリポジトリは、Shinylive/webR アプリを Tauri デスクトップアプリとして包み、合成臨床データを使ったレビュー導線、帳票、配布エビデンス生成を安全に評価するための再利用可能なハーネスです。

目的は、臨床レビュー、教育、社内 PoC、controlled demo package、release evidence workflow の評価です。検証済み臨床システム、臨床判断支援、PHI/PII 処理、規制提出、GxP 本番利用を目的としたものではありません。

English: [README.md](README.md)

## 何に役立つか

- Shinylive/webR アプリをローカルのデスクトップポータルに束ねる
- localhost 限定の Tauri shell で、静的バンドル済みアセットを実行する
- 合成臨床データパックとアプリメタデータを検証する
- HTML/PDF のデモ帳票と validation evidence pack を生成する
- static bundle hash、offline 挙動、PHI/PII guard、Tauri security、release artifact を検証する
- 資格情報なしの unsigned internal candidate、または資格情報ありの signed/notarized release candidate を作る

## 使ってはいけない用途

このリポジトリおよび同梱デモデータを、以下の用途に使わないでください。

- 診断、治療判断、患者管理
- 実治験データの運用
- 実患者データ、PHI、PII、施設識別情報、治験依頼者の機密データ
- 規制提出
- Part 11 電子記録・電子署名
- GxP 本番利用

これらの用途に使う場合は、責任組織が別途、検証、承認、手順、管理、運用体制を整備する必要があります。

## Clinical Use Limitation

このハーネスおよび同梱デモアプリは、技術評価、業務プロトタイプ、教育、合成データによるデモ専用です。検証済み医療機器、臨床判断支援ツール、規制提出用システムではありません。診断、治療、患者管理、規制提出には、責任組織による別途の検証・承認なしに使用しないでください。

同梱の臨床デモスキーマは、合成データ用の非 CDISC スキーマです。CDISC bridge report は awareness と handoff evidence のためのものであり、完全な SDTM/ADaM/Define-XML 検証は行いません。`submissionReady` は false のまま扱います。

## 構成

- `harness.toml`: プロジェクト情報、配布設定、アプリ、データパック、帳票テンプレートの source of truth
- `shinylive-src/*`: 編集対象の Shinylive アプリソース
- `data-packs/*`: 再利用可能な合成臨床データパック
- `apps/*`, `dist/*`, `reports/*`, `release/*`: 生成物
- `scripts/harness.mjs`: メイン CLI
- `src/`: diagnostics portal
- `src-tauri/`, `crates/harness-server/`: Tauri shell と Rust localhost server

## 同梱デモアプリ

- `subject-safety-mini`: harness smoke test 用の最小 Shinylive アプリ
- `subject-profile-reference`: subject selector、lab selector、AE、meds、exposure timeline、data pack hash 表示、帳票出力を持つ reference app

合成データパックには demographics、visits、labs、vitals、adverse events、concomitant medications、exposure が含まれます。subject profile、oncology safety、vaccine reactogenicity、chronic disease のシナリオ例もあります。

## Quick Start

```sh
npm ci
npm run doctor
npm run gate:bundle
```

R/Rust/Playwright/Tauri の前提が揃っている環境では、統合検証を実行できます。

```sh
npm run verify
```

開発時によく使うコマンド:

```sh
npm run validate:config
npm run validate:data
npm run smoke:multi-app
npm run export
npm run build:all
npm run verify:static
npm run verify:offline
npm run guard:phi
npm run audit:tauri-security
npm run clinical:cdisc-preflight
```

## CLI 例

```sh
node scripts/harness.mjs list
node scripts/harness.mjs add-app subject-profile-copy --template subject-profile
node scripts/harness.mjs add-data-pack subject-profile-copy ./my-data-pack --id my-synthetic-pack-v1 --copy
node scripts/harness.mjs export-reports --app subject-profile-reference
node scripts/harness.mjs export-report-pdfs
node scripts/harness.mjs review-signoff --status pending-review --decision not-reviewed
node scripts/harness.mjs evidence-index
node scripts/harness.mjs package-template
node scripts/harness.mjs verify-release --release release/
```

このテンプレートから新しい harness project を作る例:

```sh
npm run harness -- new ../my-shinylive-harness \
  --name my-shinylive-harness \
  --portal-title "My Shinylive Portal"
cd ../my-shinylive-harness
npm ci
npm run gate:bundle
```

## Release Paths

Phase 3 の preflight は3種類に分けています。

- `phase3:preflight:info`: readiness と不足 credentials を表示する確認用です。署名資格情報が無いことだけでは失敗扱いにしません。`phase3:preflight` は後方互換のため、この info mode の alias として残しています。
- `phase3:preflight:strict`: `gate:release` が使う signed release 用 preflight です。signing / notarization input の不足は blocking failure です。
- `phase3:preflight:internal:*`: unsigned internal candidate 用です。ローカル packaging tooling は必要ですが、外部配布用の署名資格情報は要求しません。

資格情報なしの unsigned internal candidate:

```sh
npm run build:release-local
npm run build:release-windows-local
npm run verify:release
```

資格情報ありの signed/notarized release candidate:

```sh
npm run phase3:preflight:strict
npm run gate:release
```

Apple Developer ID signing、notarization、Windows code signing、GitHub Release 公開、clean-machine manual acceptance には、資格情報と運用承認が必要です。

release checksum の authoritative source は `release/SHA256SUMS` です。`RELEASE_NOTES.md` は配布物の説明と `SHA256SUMS` への案内に徹し、checksum の唯一の正としては扱いません。

## Verification Gates

- `gate:bundle`: JS/TS、config、data、static、offline、PHI guard、Tauri security を見る軽量 gate
- `verify`: export、Rust tests、Playwright E2E、runtime integrity、screenshot、外部 HTTP(S) request audit を含む統合 gate
- `gate:internal-release`: unsigned internal candidate 用。internal/external readiness evidence を分離する
- `gate:release`: 資格情報ありの最終 release gate。strict Phase 3 preflight を使うため、signing / notarization credentials が未設定なら期待通り失敗します

## Evidence Outputs

生成される evidence の例:

- `reports/harness-config-validation.json`
- `reports/clinical-data-pack-validation.json`
- `reports/cdisc-bridge-preflight.json`
- `reports/static-verification.json`
- `reports/offline-verification.json`
- `reports/phi-pii-scan.json`
- `reports/tauri-security-audit.json`
- `reports/reproducibility.json`
- `reports/release-artifact-verification.json`
- `release/validation-pack.zip`
- `release/SHA256SUMS`

## 主要ドキュメント

- [Clinical audience guide](docs/clinical-audience-guide.md)
- [Clinical use limitation](docs/clinical-use-limitation.md)
- [PHI/PII policy](docs/phi-pii-policy.md)
- [Security threat model](docs/security-threat-model.md)
- [Evidence guide for clinical reviewers](docs/evidence-guide-for-clinical-reviewers.md)
- [Evidence guide for QA](docs/evidence-guide-for-qa.md)
- [Release and source packaging](docs/release-and-source-packaging.md)
- [Template CLI](docs/template-cli.md)
- [Verification](docs/verification.md)

## License

MIT。詳細は [LICENSE](LICENSE) と [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
