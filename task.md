# タスク管理 (TODO)

## 判断待ち（仕様と実装のずれ・既知の制約）
（なし）

## 完了タスク
- [x] **着彩（シングル）・着彩（マルチ）・Nano Banana 2（未作成）をいったん削除**: ツール本体と、それだけが使っていた部品（縦横比の余白計算、原画ゾーン、`?return_json=true`）を削除した。着彩ツールの safetySettings の判断待ちは取り下げ。設定ファイルに残る `coloring_*` のキーは使われない（ユーザーデータなので消していない）。
- [x] **Nano Banana Pro のモデル・API 選択**: モデル（4 種）と API（Interactions / generateContent）を先に選び、その組み合わせで使える項目だけを設定する画面にした。各項目に「既定（送らない）」がある（docs/specs/tools/nano-banana-pro.md）。
- [x] **Batch モードの選択**: 複数選択は選んだファイルだけをツリー順にグリッド表示、ファイル 1 つは 1 枚のグリッド（docs/specs/canvas.md）。
- [x] **ズーム 100% の意味を決定**: 「表示領域に収まる大きさ = 100%」を正とする（docs/specs/canvas.md）。
- [x] **削除の Undo をゴミ箱経由に**: アーカイブ内のファイル・サブフォルダも `.trash/.items/` に移し、Ctrl+Z で戻せるようにした（docs/specs/archives.md）。
- [x] **コマ分割ツール（Panel Splitter）の新規作成**
  - バックエンド: Gemini API (`gemini-3.6-flash`) による漫画コマ（frames）の自動検出と構造化JSON座標抽出 (`panel_service.py`)
  - バックエンド: Pillowによる各コマの切り分け（クロップ）と連番PNG（`01.png`, `02.png`...）の生成
  - バックエンド: `YYYYMMDD_HHMMSS_コマ分割/` ディレクトリ作成、元画像（`origin.png`）および詳細ログ（`log.txt`）の自動保存
  - バックエンド: APIエンドポイント `POST /api/image/split-panels` の追加
  - フロントエンド: `PanelSplitterTool` の実装（UI設定: 読み順選択、余白スライダー、状態カード、初期化ボタン）
  - フロントエンド: `AIPanel.ts` へのツール登録およびARCHIVES自動更新・1コマ目自動選択表示
- [x] **コマ分割ツールの保存先（サブフォルダ構成）・元フォルダへのログ1行追記・origin.png除外**
  - バックエンド: `target_folder`（選択中フォルダ）配下に `YYYYMMDD_HHMMSS_コマ分割/` サブフォルダを自動作成し、各コマ（`01.png`...）および `panels.json` を保存（`origin.png` の保存は不要化）
  - バックエンド: サブフォルダ内には `log.txt` を出力せず、元フォルダ直下の `log.txt` に `[YYYY-MM-DD HH:mm:ss] コマ分割ツールを実行し、*コマに分割しました（元ファイル名 *、サブフォルダ名: *）` の一文のみを追記
  - フロントエンド: 設定UIおよびJSONプレビューの出力ファイル一覧から `origin.png` を除外し、ログ保存先説明と同期
  - フロントエンド: ARCHIVESパネルで親フォルダとサブフォルダを自動展開し、1コマ目（`01.png`）を自動選択・表示
  - ドキュメント更新: `frontend.md` および `backend.md` に仕様決定事項を記録
