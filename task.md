# タスク管理 (TODO)

## 完了タスク
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
