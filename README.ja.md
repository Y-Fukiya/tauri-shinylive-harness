# 臨床レビュー・教育・PoC 向けのオフライン Shiny デスクトップ実行環境

このプロジェクトは、Shinylive/webR アプリをオフラインのデスクトップアプリとして配布し、合成臨床データを使ってレビュー導線、帳票、検証エビデンス生成を評価するためのハーネスです。

## 臨床レビュー Sandbox としての位置づけ

このプロジェクトは、臨床、安全性、データマネジメント、統計プログラミング、
QA、技術チームが、合成臨床データを用いてオフライン Shinylive/webR アプリを
評価するためのものです。

利用に向いている用途:

- 臨床レビュー導線のプロトタイピング
- Subject profile デモ
- Safety review デモ
- Data quality review デモ
- 教育・オンボーディング
- オフラインデモ配布
- 検証エビデンス生成フローの評価

利用してはいけない用途:

- 診断
- 治療判断
- 患者管理
- 実治験データの運用
- PHI/PII の処理
- 規制提出
- Part 11 電子記録・電子署名
- GxP 本番利用

これらの用途に使う場合は、責任組織が別途、検証、承認、管理、運用手順を
整備する必要があります。

## Clinical-Use Limitation

このハーネスおよび同梱デモアプリは、技術評価、業務プロトタイプ、教育、
合成データによるデモ専用です。検証済み医療機器、臨床判断支援ツール、
規制提出用システムではありません。診断、治療、患者管理、規制提出には、
責任組織による別途の検証・承認なしに使用しないでください。

## PHI / PII 禁止

このデモハーネスに、実患者データ、個人情報、施設識別情報、治験責任医師を
識別できる機密情報、治験依頼者の機密データを投入しないでください。同梱
データパックは合成データ専用です。

## 最初に読むファイル

- `README.md`
- `docs/clinical-audience-guide.md`
- `docs/clinical-use-limitation.md`
- `docs/phi-pii-policy.md`
- `docs/security-threat-model.md`
- `docs/evidence-guide-for-clinical-reviewers.md`
- `docs/evidence-guide-for-qa.md`
