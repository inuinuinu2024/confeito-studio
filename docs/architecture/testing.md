# テストと検証

変更後は該当する検証を必ず実行する。実際の Gemini API・ユーザーの `archives/`・`.env` には触れない。
バックエンドのファイル選択ダイアログ（画像読み込み）も実際には開かない（デスクトップに出て、閉じるまで止まるため）。

| 対象 | コマンド | 内容 |
|---|---|---|
| フロント型検査 | `cd frontend && npm run typecheck` | `tsconfig.json`（src）と `tsconfig.node.json`（vite 設定・e2e） |
| フロント単体 | `cd frontend && npm test` | vitest。`src/**/*.test.ts` |
| フロント一括 | `cd frontend && npm run check` | 型検査 + 単体 + ビルド |
| バックエンド | `cd backend && uv run pytest` | API 契約・サービスのテスト（1 秒程度） |
| バックエンド lint | `cd backend && uv run ruff check . && uv run ruff format --check .` | |
| E2E | `cd frontend && npm run e2e` | 実ブラウザで主要操作を通す（約 1 分） |

## バックエンドのテスト（`backend/tests/`）
- `conftest.py` が import 前に `CONFEITO_ENV_FILE` を存在しないファイルに向け、テストごとに
  `archives_dir` / `settings_dir` / `assets_dir` / `data_dir` / `env_file` を `tmp_path` に差し替える（実データ・API キーを読まない）。
- Gemini 呼び出しは `monkeypatch` で `gemini.generate_content` や `requests.post` を差し替える。
- ファイル選択ダイアログは `file_dialog_service._ask_open_filename` を差し替える（`tests/test_file_dialog.py`）。
- `client` フィクスチャ（`TestClient`）で HTTP 契約（ステータスコードと `detail` 形式）を検証する。

## E2E スモークテスト（`frontend/e2e/smoke.mts`）
- 一時ディレクトリをデータ置き場にして backend（48100）と Vite（45273）を起動し、インストール済みの
  Microsoft Edge（なければ Chrome）をヘッドレスで操作する。起動中の本番アプリ（48000/45173）とは衝突しない。
- 画像の読み込み（D&D）、ARCHIVES 選択、テキスト表示、ズーム、Overlay / Parallel / Batch、各ツールの設定画面と
  JSON プレビュー、プロンプトの登録・呼び出しと Prompt Manager（編集・並べ替え・カテゴリー・エクスポート / インポート）、Character Manager（画像の追加・並べ替え・削除、アイコンの切り取り、複製、zip のエクスポート / インポート）と Nano Banana画像生成からの呼び出し、未実装ツールのエラー記録、コマ結合、アーカイブの削除と Undo、設定ウィンドウ、上部バー、
  アーカイブ内のファイル・サブフォルダの削除と Undo、Batch モードでのファイル単体・複数選択を順に実行する。
- 出力: `frontend/e2e/.output/latest/` に `observations.json`（各シナリオの UI 状態・キャンバスの画素サンプル）と
  スクリーンショット（`NN-*.png`）。エージェントは画像を開いて直接確認できる。
- 時刻は `2026-01-01 10:00:00` に固定され、`observations.json` 内のタイムスタンプは `<STAMP>` / `<DATETIME>` に置換される。
  リファクタリング前後で `observations.json` を比較すれば振る舞いの差分を検出できる。
- オプション: `--headed`（ブラウザを表示）, `--keep`（一時データを残す）, `--out <dir>`, `--backend-port`, `--frontend-port`, `--root`, `--python`。
- `POST /api/local-files/pick-image`（ファイル選択ダイアログ）は常にブラウザ側で差し替える。シナリオは `stubFileDialog` で答えを決め、
  差し替えていない呼び出しはエラーになる（実際のダイアログは開かない）。
- 新しい UI を追加したら、その操作をシナリオに追加する。
