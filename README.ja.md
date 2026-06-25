[English](README.md) | **日本語**

# Tauri Shinylive Harness

[Shinylive](https://shinylive.io/) / webR アプリをデスクトップシェルに同梱して配布する
ための再利用可能なテンプレートです。R で Shiny アプリを書くと、ハーネスがそれを静的な
webR アセットに**エクスポート**し、[Tauri](https://tauri.app/) ウィンドウ内の組み込み
localhost サーバーから配信します。あわせて検証・リリース用のエビデンスも生成します。
一度エクスポートすれば、すべてオフラインで動作します。

> **臨床利用に関する制限。** このハーネスおよび同梱の合成デモアプリは技術評価専用です。
> 検証済みの医療機器ではなく、臨床的意思決定には使用できません。同梱のデモデータは合成
> データであり、SDTM/ADaM の提出モデルでは**ありません**。規制対象の用途に使う場合は、
> デモドメインを自組織の検証済み CDISC／コントロールドターミノロジーのワークフローに
> 置き換え（またはマッピング）してください。実患者データは絶対にコミットしないこと。

## 構成要素

- 設定済みアプリを一覧表示し、same-origin iframe で読み込む診断**ポータル**。
- COOP/COEP/CORP・CSP・バイトレンジ配信・実行時のバンドル整合性チェックを備えた組み込み **Rust localhost サーバー**。
- 2 つのサンプル R アプリ（`subject-safety-mini`、`subject-profile-reference`）と再利用可能な合成**データパック**。
- アプリの雛形生成・データ検証・エクスポート・デスクトップビルド梱包を行う、設定駆動の **CLI**。

## 前提ツール

| ツール | 用途 | 備考 |
| --- | --- | --- |
| Node.js 24 + npm | CLI・ポータルビルド・テスト | バージョンは `.nvmrc` に固定 |
| Rust（stable、rustup 経由） | 組み込みサーバー＋ Tauri シェル | `rust-toolchain.toml` |
| R（`Rscript`） | Shinylive エクスポート | 初回エクスポート時に `shinylive` R パッケージを `.r-lib` に導入 |
| Playwright Chromium | E2E 検証 | `npx playwright install chromium` |
| Tauri の OS 依存 | デスクトップビルド | macOS: Xcode CLT · Windows: WebView2 + MSVC · Linux: webkit2gtk, librsvg |

初回エクスポートは、Shinylive/webR アセットを `.shinylive-cache` にダウンロードするため
ネットワークが必要な場合があります。それ以降は完全にオフラインで動作します。

## クイックスタート

このテンプレートから新規プロジェクトを始める方法は 2 通りです。

**A. GitHub の "Use this template"** — リポジトリページの *Use this template* を押し、
作成された自分のリポジトリを clone してから:

```sh
npm ci
npm run export      # shinylive-src/ から apps/ を再生成（下の注意を参照）
npm run verify      # 検証 + ビルド + テスト + E2E
npm run tauri:dev   # デスクトップアプリを起動
```

**B. CLI で雛形生成** — このリポジトリのチェックアウトから:

```sh
npm run harness -- new ../my-portal --name my-portal --portal-title "My Portal"
cd ../my-portal
npm ci
npm run verify
```

> **`apps/` は生成物であり、コミットされません。** エクスポート後の webR ランタイムは
> サイズが大きいため `apps/` は git-ignore されています。clone 直後はバンドルが存在せず、
> `npm run export`（または先に export を走らせる `npm run verify`）を実行して初めて
> 生成されます。これは想定どおりの挙動です。

## プロジェクトの構成

鉄則は **「ソースと設定を編集し、出力は再生成する」**。生成ディレクトリを手で編集しないこと。

| パス | 役割 | 編集する？ |
| --- | --- | --- |
| `harness.toml` | 信頼できる唯一の情報源（プロジェクト識別・配布設定・アプリカタログ） | する |
| `shinylive-src/<app>/` | 編集可能な Shiny アプリのソース（`app.R`、`data/`） | する |
| `data-packs/<pack>/` | 再利用可能な合成データパック | する |
| `src/`、`src-tauri/`、`crates/` | ポータル UI・Tauri シェル・Rust サーバー | する |
| `templates/` | `add-app --template` が使うアプリ/レポートのテンプレート | する |
| `apps/`、`dist/`、`reports/`、`release/` | 生成物 | しない（再生成する） |

## 日々の開発ループ

アプリを追加（`subject-profile` テンプレートはデータ・レポート・DOM プローブまで設定します）:

```sh
npm run harness -- add-app lab-trends --title "Lab Trends" --template subject-profile
```

再利用可能な合成データパックをアプリに紐付け:

```sh
npm run harness -- add-data-pack lab-trends ./my-data --id lab-trends-data-v1 --copy
```

検証・エクスポート・実行:

```sh
npm run validate:config     # harness.toml をスキーマで検証
npm run validate:data       # データパックを検証（整合性・コントロールドターム・タイムライン）
npm run export              # 全アプリの webR バンドルを生成
npm run dev                 # ポータルのみ、127.0.0.1:1420 のブラウザで
npm run tauri:dev           # デスクトップアプリ一式
```

`npm run doctor` は素早いヘルスチェック（前提ツール・設定・テンプレート・データ参照）で、
不足しているものを最短で把握できます。

## コマンド一覧

CLI は `npm run harness -- <command>`（または `node scripts/harness.mjs <command>`）で実行します。

**雛形生成・データ**

| コマンド | 用途 |
| --- | --- |
| `new <dir>` | 新規ハーネスプロジェクトを雛形生成 |
| `add-app <id> [--template subject-profile]` | アプリをカタログに追加 |
| `add-data-pack <app> <dir> --id <pack> --copy` | 合成データパックを登録 |
| `list` / `doctor` | アプリ一覧 / ヘルスチェック |

**検証・エクスポート・エビデンス**

| コマンド | 用途 |
| --- | --- |
| `validate-config` / `validate-data` | スキーマ＋データ整合性チェック |
| `export [app]` | webR バンドルを生成 |
| `export-reports` / `export-report-pdfs` | HTML/PDF レポートのエビデンス生成 |
| `cdisc-preflight` | 合成->SDTM ブリッジの準備状況を確認（`submissionReady: false` のまま） |
| `review-signoff` / `evidence-index` | レビューワークフローのエビデンスを保存 |
| `verify` | Phase 2 全工程（検証 -> エクスポート -> ビルド -> テスト -> E2E） |

**梱包・リリース**

| コマンド | 用途 |
| --- | --- |
| `package-template` | 現プロジェクトから再利用可能な starter を切り出す |
| `prepare` / `build` | ポータル＋ dist をビルドし、Tauri アプリをビルド |
| `audit-tauri-security` / `reproducibility` | セキュリティ＋再現性のエビデンス |
| `verify-release` | ビルド済みリリース成果物を検証 |

これらの一部には npm エイリアス（`npm run validate:config`、`npm run verify`、
`npm run export` など）もあります。全量は `package.json` を参照してください。

## ビルドとリリース

認証情報なしのローカルリリース候補（未署名）:

```sh
npm run build:release-local          # macOS .app ＋エビデンスパック
npm run build:release-windows-local  # Windows インストーラ＋エビデンスパック
npm run verify:release
```

署名付きビルド（Apple Developer ID／notarization、Windows コード署名）や GitHub
Release の公開には認証情報が必要で、`phase3:*` スクリプトと `Release Candidate`
ワークフローに組み込まれています。`docs/phase3-distribution.md` を参照してください。

## 継続的インテグレーション（CI）

`.github/workflows/ci.yml` は macOS と Windows で `doctor`・`smoke:multi-app`・`verify`
を実行します。`verify` は重く、`shinylive` R パッケージの導入、webR アセットの
ダウンロード、Rust サーバーのコンパイル、Playwright 実行を行います。フォークで CI が
遅い／不安定な場合は、軽量で決定的なジョブ（`npm ci` -> `validate:config` ->
`validate:data` -> `test:unit` -> `check` -> `cargo test`）と、重い
エクスポート/E2E/Tauri ジョブを分離することを検討してください。

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| `docs/spec.md` | アーキテクチャと契約 |
| `docs/quickstart.md` | 詳細なセットアップ手順 |
| `docs/template-cli.md` | CLI の全リファレンス |
| `docs/clinical-data-contract.md`、`docs/cdisc-mapping.md` | データ契約と CDISC ブリッジ |
| `docs/report-export.md` | レポートテンプレートとエビデンス |
| `docs/phase3-distribution.md` | 署名・notarization・リリース |
| `AGENTS.md` | 自動コントリビューター向けの規約 |

## ライセンス

MIT — `LICENSE` を参照。同梱の合成臨床デモデータは実患者データではなく、技術評価と
デモンストレーションのためにのみ提供されます。
