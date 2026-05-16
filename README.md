# Agent Task CLI

Agent Task CLI is a JavaScript tool designed for AI-agent workflows — keeping Markdown as the single source of truth for Epics, FeatureSlices, and Tasks, while aggregating status, parent-child relationships, and timestamps into a lightweight JSON index for fast lookups, tree visualization, and done-item filtering. No npm dependencies needed. Node.js only.

Markdownファイルを実体として管理し、Epic / FeatureSlice / Task のステータスや親子関係を JSON インデックスに集約して参照・一覧表示するための軽量 CLI ツールです。

本ツールは、AIエージェントを利用したタスク管理フローにおいて、Markdownベースのタスク定義を維持しつつ、ステータス確認・親子関係の可視化・完了済みタスクの除外表示を簡単に行うことを目的としています。

## 目的

AIエージェントによる作業では、Epic、feature slice、Agent Task、Task Report などの Markdown ファイルが増えていくため、個別ファイルだけでは以下の把握が難しくなります。

- 現在どの Task が未完了か
- Task がどの Epic / FeatureSlice に紐づいているか
- open / in_progress / in_review / done の状態
- 更新日時の新旧
- 完了済みタスクを除いた現在の作業対象

このツールでは、Markdownを唯一の実体として扱いながら、必要最小限のメタデータのみを JSON インデックスに集約します。

## 基本方針

- Epic / FeatureSlice / Task の実体は Markdown ファイルとする
- JSON インデックスは検索・表示・高速参照用の派生データとする
- Markdown から JSON への反映は `update-index` で行う
- Epic / FeatureSlice / Task の親子関係は子側に親 ID を一方向参照として記述する
- Epic のステータスは Task / FeatureSlice から自動判定しない
- `updated_at` は Markdown の frontmatter で手動管理する
- 完了済み Task / FeatureSlice / Epic は、デフォルトでは `list-epics` / `list-feature-slices` / `list-tasks` / `tree` に表示しない
- 必要な場合のみオプションで完了済み項目を表示する
- CLI 出力では成功・失敗が判断しやすい Unicode 絵文字を使う
- verbose オプションで詳細ログを表示できるようにする
- `TEMPLATE.md` はファイル名で除外する（スキャン・stale 検知の対象外）

## 想定ディレクトリ構成

```text
.
├── epics/
│   ├── EPIC-001.md
│   └── EPIC-002.md
├── feature-slices/
│   ├── FS-001.md
│   └── FS-002.md
├── tasks/
│   ├── TASK-001.md
│   ├── TASK-002.md
│   └── TASK-003.md
├── .agent-task-index.json
├── agent-task.js
└── README.md
```

## Markdown メタデータ仕様

Epic / FeatureSlice / Task の Markdown ファイルには、先頭に frontmatter 形式のメタデータを記述します。

### Epic の例

```markdown
---
id: EPIC-001
type: epic
title: ユーザー認証基盤の改善
status: in_progress
updated_at: 2026-05-09
---

# EPIC-001: ユーザー認証基盤の改善

## Goal

認証フローを改善し、AIエージェントが安全にタスク分解できる状態にする。
```

### FeatureSlice の例

FeatureSlice は必ず `epic_id` で Epic に紐づけます。

```markdown
---
id: FS-001
type: feature-slice
title: ログイン画面リニューアル
epic_id: EPIC-001
status: in_progress
updated_at: 2026-05-09
---

# FS-001: ログイン画面リニューアル

## Overview

ログイン画面のUI/UXを刷新し、バリデーションを強化する。
```

### Task の例（FeatureSlice 紐づき）

Task は `epic_id` または `feature_slice_id` のいずれか一方を必須で持ちます（両方の指定はエラー）。

```markdown
---
id: TASK-001
type: task
title: ログイン画面のバリデーション追加
feature_slice_id: FS-001
status: in_review
updated_at: 2026-05-09
---

# TASK-001: ログイン画面のバリデーション追加

## Objective

ログイン画面に入力値チェックを追加する。
```

### Task の例（Epic 直接紐づき）

FeatureSlice を介さず Epic に直接紐づけることもできます。

```markdown
---
id: TASK-002
type: task
title: 認証ログの監査対応
epic_id: EPIC-001
status: open
updated_at: 2026-05-09
---

# TASK-002: 認証ログの監査対応

## Objective

認証イベントのログを監査要件に対応した形式で出力する。
```

## 管理対象メタデータ

JSON インデックスには、以下の情報のみを集約します。

### Epic

| 項目 | 説明 | 必須 |
|---|---|---|
| `id` | Epic ID | Yes |
| `type` | `epic` | Yes |
| `title` | Epic のタイトル | Yes |
| `status` | Epic の状態 | Yes |
| `updated_at` | 最終更新日 | Yes |
| `path` | Markdown ファイルパス | 自動付与 |

### FeatureSlice

| 項目 | 説明 | 必須 |
|---|---|---|
| `id` | FeatureSlice ID | Yes |
| `type` | `feature-slice` | Yes |
| `title` | FeatureSlice のタイトル | Yes |
| `epic_id` | 紐づく Epic ID | Yes |
| `status` | FeatureSlice の状態 | Yes |
| `updated_at` | 最終更新日 | Yes |
| `path` | Markdown ファイルパス | 自動付与 |

### Task

| 項目 | 説明 | 必須 |
|---|---|---|
| `id` | Task ID | Yes |
| `type` | `task` | Yes |
| `title` | Task のタイトル | Yes |
| `epic_id` | 紐づく Epic ID | `feature_slice_id` がない場合 |
| `feature_slice_id` | 紐づく FeatureSlice ID | `epic_id` がない場合 |
| `status` | Task の状態 | Yes |
| `updated_at` | 最終更新日 | Yes |
| `path` | Markdown ファイルパス | 自動付与 |

`epic_id` と `feature_slice_id` は同時に指定できません。どちらも指定しない Task（独立 Task）は許容されます。

Markdown本文の詳細内容は JSON に複製せず、必要に応じて `path` から Markdown ファイルを参照します。

## ステータス仕様

以下のステータスのみを使用します。

| Status | 意味 |
|---|---|
| `open` | 未着手、または作業可能な状態 |
| `in_progress` | 作業中 |
| `in_review` | レビュー中 |
| `done` | 完了 |

`done` の項目は、デフォルトでは `list-epics` / `list-feature-slices` / `list-tasks` / `tree` の表示対象から除外されます。

## 階層構造

Epic / FeatureSlice / Task の紐づけルールを以下に示します。

### 3層構造（Epic → FeatureSlice → Task）

Epic に FeatureSlice を紐づけ、Task を FeatureSlice に紐づけることで 3 層の階層を表現できます。

```
Epic
└─ FeatureSlice (epic_id → Epic)
   └─ Task (feature_slice_id → FeatureSlice)
```

### 2層構造（Epic → Task）

FeatureSlice を使わず Task を直接 Epic に紐づけることもできます。

```
Epic
└─ Task (epic_id → Epic)
```

2層構造と3層構造は同一の Epic 内で混在させることができます。

### 独立 Task

`epic_id` も `feature_slice_id` も持たない独立 Task も許容されます。

### 許容される状態

- `feature_slice_id` が存在し、参照先 FeatureSlice も存在する Task
- `epic_id` が存在し、参照先 Epic も存在する Task
- `epic_id` も `feature_slice_id` も存在しない Task（独立 Task）
- `epic_id` が存在し、参照先 Epic も存在する FeatureSlice

### エラーとなる状態

- `epic_id` と `feature_slice_id` の両方を持つ Task
- `epic_id` が存在するが、参照先 Epic が存在しない Task
- `feature_slice_id` が存在するが、参照先 FeatureSlice が存在しない Task
- `epic_id` が存在するが、参照先 Epic が存在しない FeatureSlice

## JSON インデックス仕様

インデックスファイルは Markdown から生成される派生データです。

デフォルトファイル名:

```text
.agent-task-index.json
```

### 例

```json
{
  "generated_at": "2026-05-09T10:00:00.000Z",
  "epics": [
    {
      "id": "EPIC-001",
      "type": "epic",
      "title": "ユーザー認証基盤の改善",
      "status": "in_progress",
      "updated_at": "2026-05-09",
      "path": "epics/EPIC-001.md"
    }
  ],
  "feature_slices": [
    {
      "id": "FS-001",
      "type": "feature-slice",
      "title": "ログイン画面リニューアル",
      "epic_id": "EPIC-001",
      "status": "in_progress",
      "updated_at": "2026-05-09",
      "path": "feature-slices/FS-001.md"
    }
  ],
  "tasks": [
    {
      "id": "TASK-001",
      "type": "task",
      "title": "ログイン画面のバリデーション追加",
      "feature_slice_id": "FS-001",
      "status": "in_review",
      "updated_at": "2026-05-09",
      "path": "tasks/TASK-001.md"
    },
    {
      "id": "TASK-002",
      "type": "task",
      "title": "認証ログの監査対応",
      "epic_id": "EPIC-001",
      "status": "open",
      "updated_at": "2026-05-09",
      "path": "tasks/TASK-002.md"
    }
  ]
}
```

JSON インデックスは手動編集せず、常に Markdown から再生成することを前提とします。

## インデックスの自動更新（Auto Update）

`list-epics` / `list-feature-slices` / `list-tasks` / `tree` の各コマンドは、実行前にインデックスの状態を自動チェックします。

### 自動更新の条件

以下のいずれかに該当する場合、コマンド実行前に `update-index` を自動的に実行します。

- インデックスが存在しない場合: `.agent-task-index.json` が存在しない場合、自動的にインデックスを生成します。
- インデックスが古い（stale）場合: `epics/`、`feature-slices/`、または `tasks/` 配下の Markdown ファイルのいずれかが、インデックスファイルよりも新しいタイムスタンプを持つ場合、インデックスを古いと判定し自動更新します。

Markdown の frontmatter に不正な記述や ID 重複などの検証エラーがある場合、自動更新は失敗します。手動で `update-index` を実行して問題を解消してください。

### stale 検知の対象および制限

以下のファイルをstale 検知の対象とします。

- `epics/`、`feature-slices/`、および `tasks/` 直下の Markdown ファイル（`.md`, `.markdown`）
- `TEMPLATE.md` は除外対象のため stale 検知の対象外

stale 検知はファイルシステムのタイムスタンプ（mtime）を使用します。そのため、Markdown ファイルの内容を変更せずにタイムスタンプだけが更新された場合も再インデックスが走ります。逆に、タイムスタンプが変化しない操作（`git checkout` 後に mtime が復元されるケースなど）では stale と判定されない場合があります。

## CLI コマンド

### update-index

Markdown ファイルを走査し、JSON インデックスを更新します。Epic / FeatureSlice / Task の Markdown ファイルの整合性の検証に失敗した場合はエラーログを出力し終了します。

```bash
node agent-task.js update-index
```

### list-epics

Epic の一覧を表示します。`updated_at` の降順、同日の場合は ID の昇順で並びます。

```bash
node agent-task.js list-epics
```

デフォルトでは `done` の Epic は表示しません。

完了済みも含める場合:

```bash
node agent-task.js list-epics --with-done
```

出力例:

```text
📦 EPIC-001 [in_progress] 2026-05-09 epics/EPIC-001.md ユーザー認証基..
```

### list-feature-slices

FeatureSlice の一覧を表示します。`updated_at` の降順、同日の場合は ID の昇順で並びます。

```bash
node agent-task.js list-feature-slices
```

デフォルトでは `done` の FeatureSlice は表示しません。

完了済みも含める場合:

```bash
node agent-task.js list-feature-slices --with-done
```

出力例:

```text
📚 FS-001 [in_progress] 2026-05-09 epic:EPIC-001 feature-slices/FS-001.md ログイン画面リ..
```

### list-tasks

Task の一覧を表示します。`updated_at` の降順、同日の場合は ID の昇順で並びます。

```bash
node agent-task.js list-tasks
```

デフォルトでは `done` の Task は表示しません。

完了済みも含める場合:

```bash
node agent-task.js list-tasks --with-done
```

特定 Epic に直接紐づく Task のみに絞る場合:

```bash
node agent-task.js list-tasks --epic EPIC-001
```

特定 FeatureSlice に紐づく Task のみに絞る場合:

```bash
node agent-task.js list-tasks --feature-slice FS-001
```

Epic にも FeatureSlice にも紐づかない独立 Task のみ表示する場合:

```bash
node agent-task.js list-tasks --no-parent
```

出力例:

```text
📝 TASK-001 [in_review] 2026-05-09 fs:FS-001 tasks/TASK-001.md ログイン画面の..
📝 TASK-002 [open] 2026-05-09 epic:EPIC-001 tasks/TASK-002.md 認証ログの監査..
```

### tree

Epic・FeatureSlice・Task の親子関係をツリー表示します。Epic は ID 昇順、FeatureSlice および Task も ID 昇順で表示されます。

Epic 配下には FeatureSlice と Epic 直接紐づきの Task が表示されます。FeatureSlice 配下にはその FeatureSlice に紐づく Task がさらにインデントして表示されます。

```bash
node agent-task.js tree
```

デフォルトでは `done` の Epic / FeatureSlice / Task は表示しません。

完了済みも含める場合:

```bash
node agent-task.js tree --with-done
```

出力例（2層と3層の混在）:

```text
📦 EPIC-001 [in_progress] 2026-05-09 epics/EPIC-001.md ユーザー認証基..
  ├─ 📚 FS-001 [in_progress] 2026-05-09 feature-slices/FS-001.md ログイン画面リ..
  │   ├─ 📝 TASK-001 [in_review] 2026-05-09 tasks/TASK-001.md ログイン画面の..
  │   └─ 📝 TASK-003 [open] 2026-05-09 tasks/TASK-003.md パスワードリセッ..
  └─ 📝 TASK-002 [open] 2026-05-09 tasks/TASK-002.md 認証ログの監査..

📦 EPIC-002 [open] 2026-05-09 epics/EPIC-002.md 通知基盤の整備..
  ├─ 📝 TASK-004 [in_progress] 2026-05-09 tasks/TASK-004.md メール通知の実装..
  └─ 📝 TASK-005 [open] 2026-05-09 tasks/TASK-005.md Slack通知の実装..

📦 No Epic
  └─ 📝 TASK-006 [open] 2026-05-09 tasks/TASK-006.md 調査タスク
```

## 共通オプション

| オプション | 説明 |
|---|---|
| `--with-done` | 完了済みの Epic / FeatureSlice / Task も表示する |
| `--verbose` | 詳細ログを出力する |
| `--epic <EPIC_ID>` | 指定した Epic に直接紐づく Task のみ表示する（`list-tasks` のみ） |
| `--feature-slice <FS_ID>` | 指定した FeatureSlice に紐づく Task のみ表示する（`list-tasks` のみ） |
| `--no-parent` | Epic にも FeatureSlice にも紐づかない独立 Task のみ表示する（`list-tasks` のみ） |
| `--help`, `-h` | ヘルプを表示する |

`--epic` と `--no-parent` は同時に指定できません。

## Hooks 連携

Markdown 更新後に `update-index` を実行することで、JSON インデックスを最新化します。

なお、`list-epics` / `list-feature-slices` / `list-tasks` / `tree` は実行時に自動でインデックスの鮮度を確認するため、手動での `update-index` 実行を省略することもできます。ただし、CI や pre-commit hook で確実に最新のインデックスを維持したい場合は、明示的に実行することを推奨します。

想定される連携例:

- Git pre-commit hook
- Git post-merge hook
- 手動実行
- AIエージェントの作業完了後コマンド

例:

```bash
node agent-task.js update-index
```

JSON インデックスは派生データであるため、常に Markdown から再生成可能であることを前提とします。

## 設計上の判断

### Markdown を実体とする理由

Markdown は人間と AIエージェントの両方が読み書きしやすく、Git による差分管理にも適しています。

また、タスク本文・背景・判断理由・Task Report など、構造化しきれない情報を自然に保持できます。

### JSON インデックスを持つ理由

Markdown ファイルだけでは一覧表示や親子関係の可視化、完了済みタスクの除外が難しくなります。

JSON インデックスを持つことで、CLI は Markdown 全文を毎回解釈せずに、高速かつ一貫した表示を行えます。

### ステータスを Markdown 内に持つ理由

ステータスはタスクの状態そのものであり、Markdown ファイルの履歴と一緒に管理されるべき情報です。

一方で、横断的な一覧表示には向かないため、JSON インデックスへ集約します。

### Epic のステータスを自動判定しない理由

Epic は単なる Task の集約ではなく、プロダクト上の判断や人間の意思決定を含む場合があります。

そのため、Epic の `status` は Task / FeatureSlice の状態から自動計算せず、Markdown 内で明示的に管理します。

### FeatureSlice を導入した理由

Epic と Task の 2 層では、大きな Epic をさらに機能単位（スライス）に分割して作業を整理したい場合に対応できません。

FeatureSlice を導入することで、Epic → FeatureSlice → Task の 3 層構造を表現でき、スコープの大きな Epic でも作業の粒度を整理しやすくなります。2 層構造（Epic → Task）も引き続き利用できるため、規模に応じた構造を選べます。

### Task の親を epic_id または feature_slice_id の一方のみとする理由

Task が複数の親を持つと、ツリー表示での位置やフィルタリングの動作が不明確になります。

`epic_id` と `feature_slice_id` の同時指定はエラーとし、Task が属する階層を常に一意に決定します。

### --no-parent オプションの対象を epic_id・feature_slice_id の両方とする理由

`--no-parent` は「どの親にも紐づかない独立 Task」を表示するためのオプションです。

FeatureSlice の導入により、親の候補が `epic_id` と `feature_slice_id` の 2 種類になったため、どちらも持たない Task のみを対象とします。

### 完了済みをデフォルト非表示にする理由

通常の作業では、未完了・進行中・レビュー中の項目が重要です。

完了済みタスクをデフォルト表示するとノイズが増えるため、必要な場合のみ `--with-done` で表示します。

### ID 重複をエラーにする理由

ID が重複すると、親子関係の解決や Markdown ファイル参照が不正確になります。

AIエージェントが誤った Task / FeatureSlice / Epic を参照するリスクが高いため、`update-index` では ID 重複を必須エラーとして扱います。

### 不正な参照をエラーにする理由

存在しない Epic や FeatureSlice を参照している場合、ツリー表示や作業対象の判断が壊れます。

一方で、どの親にも紐づかない独立 Task は有効な場合があるため許容します。

### インデックスを自動更新する理由

`list-epics` / `list-feature-slices` / `list-tasks` / `tree` の実行時にインデックスが存在しない、または古い場合、手動で `update-index` を実行する手間を省くため、自動更新を行います。

ただし、自動更新はエラーがあっても処理を止めずに警告を出すに留め、コマンドの実行継続を優先します。
