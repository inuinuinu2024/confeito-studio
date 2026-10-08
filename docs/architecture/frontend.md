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
│   ├── state/                # view-mode.ts（表示モード）, tool-settings.ts（ツール設定の永続化）, canvas-background.ts（キャンバスの背景色）
│   ├── types/                # ArchiveEntry, FlowData / FlowRun / FlowImage（処理フロー）, Tool / ToolContext / RunTarget / ToolNotReady / ToolCancelled
│   ├── ui/                   # h() / icon(), form 部品, dialogs, toast（showToast / showError）, resizer, drag-sort（ドラッグで並べ替え）,
│   │                         # window（別ウィンドウの共通部品。見出し・×・外のクリックで閉じる）, image-viewer（画像を大きく見るウィンドウ。ズーム・移動）,
│   │                         # category-sidebar（マネージャー共通のカテゴリー一覧）
│   ├── utils/                # datetime, error-message(describeError), image(Blob/Canvas 変換), history(削除の Undo。削除と Undo を 1 つずつ順に実行),
│   │                         # categories(カテゴリー付き一覧の共通処理), prompts(登録プロンプトの入力チェック・絞り込み・エクスポート形式),
│   │                         # characters(登録キャラクターの絞り込み・ツールで使う時の説明文), icon-crop(アイコンの切り取り枠の計算),
│   │                         # rect-crop(コマの切り直しの枠（自由な長方形）の計算),
│   │                         # usage(Cost Monitor の期間・グラフの系列・1 回あたりの平均・円 / USD の表示。集計はバックエンド)
│   └── styles/               # variables(トークン), base, components(cs-*), layout(グリッド), manager(マネージャー共通の mgr-*)
└── features/
    ├── top-bar/              # アプリ名・アイコン, 設定ウィンドウ（API・表示）, ショートカット
    ├── tool-bar/             # 左端の表示モード切替ボタン（Prompt Manager / Character Manager / Cost Monitor も表示モード）
    ├── prompt-manager/       # Prompt Manager（カテゴリー一覧 = 左サイドバー、一覧と編集欄 = メイン領域。transfer.ts = エクスポート / インポート）
    ├── cost-monitor/         # Cost Monitor（メイン領域のダッシュボード。daily-chart.ts = 日別の積み上げ棒（SVG・日の選択）、
    │                         # bar-list.ts = ツール別の横棒、day-detail.ts = 選んだ日の内訳、parts.ts = 金額（円優先）・表の部品）
    ├── character-manager/    # Character Manager（Prompt Manager と同じ構成。image-list.ts = 編集欄の画像、icon-cropper.ts = アイコンの切り取り、transfer.ts = zip のエクスポート / インポート）
    ├── flow-canvas/          # Workspace（Normal モード）の処理フロー。FlowCanvas.ts = 画面と操作、flow-graph.ts = info.json から図・スタック・
    │                         # 削除範囲・コマ結合の差し替えを作る純粋関数、flow-layout.ts = 自動配置と線、pan-zoom.ts、thumbnails.ts、
    │                         # deletion.ts = 削除と Undo、side-pane.ts = 3 枚構成の左右のペイン（元ページ / コマ結合後）、
    │                         # panel-cropper.ts = コマの切り直し（ページ上の範囲の表示・切り直し・版の切り替え）
    ├── canvas/               # 比較キャンバス（Parallel / Overlay。canvas-state / render / zoom / toolbars）
    ├── ai-panel/             # ツール一覧・並び替え・実行（tool-runner、run-targets = まとめて実行の対象と通知文）・ツールウィンドウ（components/ToolWindow.ts）
    ├── document/             # DocumentManager（表示中のアーカイブ・その処理フロー・選択中の画像）
    ├── status-bar/
    └── tools/                # AI ツール（1 ツール 1 ファイル、大きいものは <id>/ フォルダ）。index.ts が一覧
        ├── gemini-image/     # Gemini 画像ツールの共通部品（参照画像の一覧・プロンプト欄と登録プロンプトの登録 / 呼び出し・
        │                     # 登録キャラクターの呼び出し（character-picker.ts）・送信テキスト）
        └── nano-banana-pro/  # models.ts（モデルごとの対応値）, options.ts（設定項目と解決）,
                              # request.ts（API 別のリクエスト組み立て）, nano-banana-pro.ts（画面）,
                              # original.ts / original-image.ts（原画: 余白付けと元の大きさへの戻し）
```

## 主要な仕組み

### イベントバス（`shared/events.ts`）
機能間の通知はすべて `emit(name, detail)` / `on(name, handler)` で行う。`window.dispatchEvent` を直接使わない。
イベント名と detail の型は `AppEventMap` が唯一の定義。送信元/受信先は `grep "emit('名前'"` / `grep "on('名前'"` で追える。

| イベント | 送信元 → 受信先 | 意味 |
|---|---|---|
| `flow:selection-changed` | DocumentManager（FlowCanvas が選択を変えた時）→ 受け手は任意 | 選択中の画像（選んだ順）が変わった |
| `archives:changed` | ツール/削除処理 → FlowCanvas, Canvas | ファイルが変わった。FlowCanvas はアーカイブ一覧と処理フローを読み直し、`select` の画像を選ぶ（そのアーカイブへ切り替える）。`archive` があればそのアーカイブを表示。Canvas は比較中の画像を読み直す |
| `archives:location-changed` | 設定ウィンドウ（保存先）→ FlowCanvas | アーカイブのフォルダを切り替えた。選択・サムネイル・Undo の履歴を捨て、新しいフォルダの一番新しいアーカイブを表示 |
| `<mode>-mode:toggle` | view-mode.ts → 各機能 | 表示モードの ON/OFF（normal = Workspace /parallel/overlay/prompt/character/cost）。prompt は Prompt Manager、character は Character Manager、cost は Cost Monitor（app.ts がメイン領域を入れ替える）。Canvas は parallel / overlay の開始時に選択から比較する画像を取る |
| `tool:start` / `tool:progress` / `tool:end` | tool-runner, ツール → StatusBar, FlowCanvas（`tool:end` は Cost Monitor も受けて読み直す） | 実行状況。FlowCanvas は実行中の結果をまとめて選ぶ |
| `tool:target` | tool-runner → FlowCanvas | まとめて実行の 1 枚ごとの状態（running / done / failed）。セルに印を付ける |
| `canvas:bg-color`, `settings:updated`, `history:changed` | 設定ウィンドウ, history | 背景色 / API キー保存 / Undo できるかが変わった（Workspace の削除・元に戻すボタン） |

### 状態の持ち場所
- **表示モード**: `shared/state/view-mode.ts` が唯一の正。変更は `setViewMode()` / `toggleViewMode()` のみ。
  `toggleViewMode()` は今のモードの `setLeaveGuard()`（Prompt Manager / Character Manager の未保存の確認）を待ってから切り替える。
  参照は `isViewMode('normal')` 等。Canvas は描画順序を保つため toggle イベントで自前のフラグも更新する。
- **表示中のアーカイブ・選択**: `DocumentManager`（FlowCanvas が書く）。`getArchive()` は結果の保存先（`features/tools/result.ts` の `currentArchive()`）、
  `getFlow()` はその処理フロー（コマ結合が `flow-graph.ts` で差し替えを計算する）、`getSelection()` は選択中の画像（選んだ順）。
  ツールは `DocumentManager` ではなく `ToolContext.target`（1 回の実行の対象）を使う。
- **ツール設定**: `toolSettings('<prefix>')`（キーは `<prefix>_<key>`）。`set` はメモリ上だけ変え、ツールの `settingsPrefix` の変更分を
  `tool-runner` が実行開始時に保存する。ツールウィンドウを開く時に `loadSettings()` で読み直す（未保存の変更は消える）。
  明示的な保存操作だけ `settings.save([key])` でその場で書く（[specs/app-shell.md](../specs/app-shell.md)「設定の保存」）。
- **UI の好み**（ツールの並び順、Workspace で表示したアーカイブ）: ツール設定と同じ仕組み（`toolSettings('aiPanel')`・`toolSettings('flowCanvas')`、
  変えた時点で保存。[specs/ai-panel.md](../specs/ai-panel.md)）。候補の採用（スタックの表示中の実行）はアーカイブの `.flow.json`（`PUT /archives/{name}/flow/selection`）。
  Workspace のサムネイルはメモリ上の object URL（`flow-canvas/thumbnails.ts`）。
  localStorage・IndexedDB などブラウザ側の保存は使わない（[specs/app-shell.md](../specs/app-shell.md)「ブラウザに残すもの」）。
- **HTTP キャッシュ**: 使わない。`shared/api/http.ts` は `cache: 'no-store'` で fetch し、バックエンド（`main.py` のミドルウェア）と
  Vite 開発サーバー（`vite.config.mts` の `noStorePlugin`）は全応答に `Cache-Control: no-store` を付ける。

### API 層（`shared/api/`）
- エンドポイントごとに型付き関数を用意する（`archives.ts`, `image.ts`, `generation.ts`, `local-files.ts`, `settings.ts`, `system.ts`）。
- 失敗時は `ApiError`（`message`, `status`, `detail`, `body`, `rawResponse`）を投げる。
  バックエンドのエラー形式は常に `{"detail": string | {message, raw_response}}`（message は日本語、raw_response は原文）。
- ツールの結果は `features/tools/result.ts` の `saveToolResult()`（中で `saveResult()` → `POST /archives/results`）で保存する。

### 通知とエラー（`shared/ui/toast.ts`, `shared/utils/error-message.ts`）
- 仕様は [specs/notifications.md](../specs/notifications.md)。成功・案内・注意は `showToast(message, 'success' | 'info' | 'warning')`、
  失敗は `showError(見出し, err)`（閉じるまで残り、`describeError(err)` が日本語メッセージと原文に分ける）。`alert()` は使わない。
- フロントエンドで日本語のエラーを投げるときは `AppMessageError(message, 原文?)`。`ApiError` はそのまま投げてよい（包み直さない）。

### UI 部品（`shared/ui/`）
- `h(tag, props, ...children)`: 要素生成。`class`/`style`/`text`/`dataset` 以外の props はプロパティとして代入。
- `form.ts`: `field`, `select`, `slider`, `switchRow`, `button`, `iconButton`, `note`, `helpIcon`。
- `dialogs.ts`: `createModal`, `openJsonPreview`, `confirmDialog`（はい/いいえ → Promise<boolean>）, `escapeClosable`（いちばん上のダイアログだけ Esc で閉じる）。`toast.ts`: `showToast`, `showError`。
- インラインスタイルは原則使わず CSS クラスで書く。

### CSS
- `shared/styles/variables.css` がデザイントークン。色・寸法はトークンを使う。
- 共通部品は `components.css`（`cs-` 接頭辞）。機能固有は `features/<name>/<name>.css` に置き、その機能の TS から import する。
- クラス名は BEM。

## 実装手順

### ツールを追加する
1. `features/tools/<id>.ts`（大きいツールは `features/tools/<id>/<id>.ts` + 部品）に `Tool`（`shared/types/tool.ts`）を実装する。
   - 設定が必要なら `renderSettings(container)` を実装し `shared/ui/form.ts` の部品で組む。設定値は `toolSettings('<prefix>')` で、
     同じ接頭辞を `settingsPrefix` に宣言する（実行開始時に変更分が保存される。宣言しないと保存されない）。
   - ウィンドウを開く前に状態を整える必要があれば `beforeOpen()` を実装する（設定を読み直した後に呼ばれる。例: Nano Banana画像生成が選択中の画像を原画に入れる）。
   - `execute()` は対象 1 つにつき 1 回呼ばれる（`context.target`。選択中の画像それぞれ、選んだ順。[specs/ai-panel.md](../specs/ai-panel.md)「まとめて実行」）。
     画像は `context.getSelectedImage()`、結果の `source` は `context.target.key`。選択を使わない・まとめ方が違うツールは
     `targets(selection)` を実装する（入力なしで 1 回なら `[null]`。例: 画像読み込み、コマ結合はコマ分割ごと）。
   - `execute()` は結果の要約（日本語）を返す。共通処理（`ai-panel/tool-runner.ts`）が「<ツール名>: <要約>」のトーストを出すので、ツール自身は成功トーストを出さない。
   - 入力が足りない（画像未選択など）ときは `execute()` の先頭で `throw new ToolNotReady('案内')`（1 回目なら注意トーストで全体を止め、失敗扱いにしない）。
     確認が済んだら `context.ready()` を呼ぶ（ツールウィンドウがそこで閉じ、処理は裏で続く。呼ばないと成功するまで閉じない）。
   - 停止（▶ の ⏸）に対応する: 結果をフロントで保存するリクエストには `context.signal` を渡し、結果を保存した直後に
     `discardIfStopped(context.signal, 結果フォルダ)` を呼ぶ（停止されていれば保存した結果を消して中断する。バックエンドが保存するツールも同じ）。
     キャンセルは `throw new ToolCancelled()`。失敗は `AppMessageError` を投げるか `ApiError` をそのまま通す。ログファイルは書かない。
   - バックエンド呼び出しは `shared/api/` に関数を追加して使う。
   - 結果は `saveToolResult(ツール名, files, { source, settings })` で保存する（表示中のアーカイブの中の `<日時>_<ツール名>/` と info.json。
     [specs/archives.md](../specs/archives.md)「ツールの結果の保存」）。保存後は `emit('archives:changed', { select: [<結果画像のキー>] })` で Workspace に出して選択する。
2. `features/tools/index.ts` の `TOOLS` に追加する（並び順 = ツール一覧の初期順）。
3. `docs/specs/tools/<id>.md` に仕様を書く。

### イベントを追加する
`AppEventMap` に名前と detail 型を追加し、`emit` / `on` で使う。上の表も更新する。

### バックエンド API を呼ぶ
`shared/api/<領域>.ts` に型付き関数を追加する（直接 `fetch` しない）。レスポンス型はバックエンドの戻り値と合わせる。

## テスト
- 純粋関数は隣に `*.test.ts`（vitest）。DOM に依存しないロジック（処理フローの組み立て・配置・並び順・幾何計算）を切り出してテストする。
- 画面の振る舞いは E2E（[testing.md](./testing.md)）。
