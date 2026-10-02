# フロントエンド設計

Vite + TypeScript (strict)。UI フレームワークは使わず、各コンポーネントは `create*()` 関数が
`HTMLElement` を返す。機能（feature）単位でフォルダを分け、共通部品は `shared/` に置く。

## ディレクトリ

```text
frontend/src/
├── app.ts                    # エントリ: backend 待機 → 設定読込 → 画面グリッド組み立て
├── shared/                   # 機能をまたぐ部品（features を import しない）
│   ├── config.ts             # API_BASE（VITE_API_BASE）, 拡張子パターン
│   ├── events.ts             # 型付きイベントバス emit()/on() と AppEventMap（イベント一覧）
│   ├── api/                  # バックエンド呼び出しはすべてここ経由（http.ts が ApiError を作る）
│   ├── state/                # view-mode.ts（表示モード）, tool-settings.ts（ツール設定の永続化）
│   ├── types/                # ArchiveEntry, Tool / ToolContext / ToolError
│   ├── ui/                   # h() / icon(), form 部品, dialogs, toast, resizer
│   ├── utils/                # datetime, image(Blob/Canvas 変換), history(Undo), idb
│   └── styles/               # variables(トークン), base, components(cs-*), layout(グリッド)
└── features/
    ├── top-bar/              # メニュー, 設定ダイアログ, 背景色ダイアログ, ショートカット
    ├── tool-bar/             # 左端の表示モード切替ボタン
    ├── archive-panel/        # ARCHIVES ツリー（archive-tree.ts = 純粋関数）
    ├── canvas/               # 表示領域（canvas-state / render / zoom / toolbars）
    ├── ai-panel/             # ツール一覧・タブ・並び替え・実行（tool-runner）・設定サイドバー
    ├── document/             # DocumentManager（現在の画像と保存先フォルダ）
    ├── status-bar/
    └── tools/                # AI ツール（1 ツール 1 ファイル、大きいものは <id>/ フォルダ）。index.ts が一覧
        ├── gemini-image/     # Gemini 画像ツールの共通部品（参照画像ゾーン・プロンプト欄・送信テキスト）
        └── nano-banana-pro/  # models.ts（モデルごとの対応値）, options.ts（設定項目と解決）,
                              # request.ts（API 別のリクエスト組み立て）, nano-banana-pro.ts（画面）
```

## 主要な仕組み

### イベントバス（`shared/events.ts`）
機能間の通知はすべて `emit(name, detail)` / `on(name, handler)` で行う。`window.dispatchEvent` を直接使わない。
イベント名と detail の型は `AppEventMap` が唯一の定義。送信元/受信先は `grep "emit('名前'"` / `grep "on('名前'"` で追える。

| イベント | 送信元 → 受信先 | 意味 |
|---|---|---|
| `archive:item-selected(:right)` | ArchivePanel → Canvas | ファイルを選択（テキストは文字表示） |
| `archive:selection-cleared(:right)` | ArchivePanel → Canvas | 選択解除（キャンバスを空に） |
| `archive:batch-selected` | ArchivePanel → Canvas | Batch モードでの選択（グリッド表示する画像の一覧） |
| `archives:changed` | ツール/削除処理 → ArchivePanel | 一覧を再取得。`autoSelectKey` があれば展開して選択 |
| `<mode>-mode:toggle` | view-mode.ts → 各機能 | 表示モードの ON/OFF（normal/compare/overlay/batch） |
| `overlay:underdrawing-selected(:right)` | ArchivePanel → ArchivePanel, Canvas | Overlay の下絵(U) 選択 |
| `overlay-mode:changed` | ArchivePanel → ArchivePanel | U チェックボックスの再同期 |
| `document:loaded` / `document:closed` / `document:redraw` | DocumentManager → Canvas | 現在画像の変更 / 再描画要求 |
| `file:save` / `file:save-as` / `file:close` | メニュー, ショートカット → DocumentManager | ファイル操作 |
| `tool:start` / `tool:progress` / `tool:end` | tool-runner, ツール → StatusBar | 実行状況 |
| `canvas:bg-color`, `settings:updated`, `history:changed` | 各ダイアログ, history | 背景色 / API キー保存 / Undo スタック変化 |

`:right` 付きは Compare モードで AI パネルの代わりに表示される 2 つ目の ARCHIVES パネル由来。

### 状態の持ち場所
- **表示モード**: `shared/state/view-mode.ts` が唯一の正。変更は `setViewMode()` / `toggleViewMode()` のみ。
  参照は `isViewMode('batch')` 等。Canvas は描画順序を保つため toggle イベントで自前のフラグも更新する。
- **現在の画像・保存先**: `DocumentManager`。`getCurrentCanvas()` はツールが処理する画像、
  `getCurrentArchiveFolder()` はツールの保存先（アーカイブキー。詳細は [specs/archives.md](../specs/archives.md)）。
- **ツール設定**: `toolSettings('<prefix>')` で `settings/default_prompts.json` に保存（キーは `<prefix>_<key>`）。
- **UI の好み**（タブ・並び順）: localStorage（[specs/ai-panel.md](../specs/ai-panel.md)）。

### API 層（`shared/api/`）
- エンドポイントごとに型付き関数を用意する（`archives.ts`, `image.ts`, `generation.ts`, `settings.ts`, `system.ts`）。
- 失敗時は `ApiError`（`message`, `status`, `detail`, `body`, `rawResponse`）を投げる。
  バックエンドのエラー形式は常に `{"detail": string | {message, raw_response}}`。
- サブフォルダを含むフォルダキー（`root/sub`）への保存・ログ追記は `saveToFolder()` / `appendFolderLog()` を使う。

### UI 部品（`shared/ui/`）
- `h(tag, props, ...children)`: 要素生成。`class`/`style`/`text`/`dataset` 以外の props はプロパティとして代入。
- `form.ts`: `field`, `select`, `slider`, `switchRow`, `button`, `iconButton`, `note`, `helpIcon`。
- `dialogs.ts`: `createModal`, `openJsonPreview`, `openTextEditDialog`。`toast.ts`: `showToast`。
- インラインスタイルは原則使わず CSS クラスで書く。

### CSS
- `shared/styles/variables.css` がデザイントークン。色・寸法はトークンを使う。
- 共通部品は `components.css`（`cs-` 接頭辞）。機能固有は `features/<name>/<name>.css` に置き、その機能の TS から import する。
- クラス名は BEM。ARCHIVES パネルは歴史的経緯で `layer-*` 接頭辞のまま。

## 実装手順

### ツールを追加する
1. `features/tools/<id>.ts`（大きいツールは `features/tools/<id>/<id>.ts` + 部品）に `Tool`（`shared/types/tool.ts`）を実装する。
   - 設定が必要なら `renderSettings(container)` を実装し `shared/ui/form.ts` の部品で組む。設定値は `toolSettings('<prefix>')`。
   - 実行条件は `canOpen()`（false を返すならトーストで理由を出す）。キャンセルは `throw new ToolCancelled()`。
   - バックエンド呼び出しは `shared/api/` に関数を追加して使う。保存後は `emit('archives:changed', { autoSelectKey })`。
2. `features/tools/index.ts` の `TOOLS` に追加する（並び順 = All Tools の初期順）。
3. `docs/specs/tools/<id>.md` に仕様を書く。

### イベントを追加する
`AppEventMap` に名前と detail 型を追加し、`emit` / `on` で使う。上の表も更新する。

### バックエンド API を呼ぶ
`shared/api/<領域>.ts` に型付き関数を追加する（直接 `fetch` しない）。レスポンス型はバックエンドの戻り値と合わせる。

## テスト
- 純粋関数は隣に `*.test.ts`（vitest）。DOM に依存しないロジック（ツリー構築・並び順・幾何計算）を切り出してテストする。
- 画面の振る舞いは E2E（[testing.md](./testing.md)）。
