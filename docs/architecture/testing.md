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
| E2E | `cd frontend && npm run e2e` | 実ブラウザで主要操作を通す（全シナリオで数分。`-- --only 12` で一部だけ） |

## バックエンドのテスト（`backend/tests/`）
- `conftest.py` が import 前に `CONFEITO_ENV_FILE` を存在しないファイルに向け、テストごとに
  `archives_dir` / `settings_dir` / `assets_dir` / `data_dir` / `env_file` を `tmp_path` に差し替える（実データ・API キーを読まない）。
- Gemini 呼び出しは `monkeypatch` で `gemini.generate_content` や `requests.post` を差し替える。
- ファイル選択ダイアログは `file_dialog_service._ask_open_filename` を差し替える（`tests/test_file_dialog.py`）。
- `client` フィクスチャ（`TestClient`）で HTTP 契約（ステータスコードと `detail` 形式）を検証する。

## E2E スモークテスト（`frontend/e2e/smoke.mts`）
- 一時ディレクトリをデータ置き場にして backend（48100）と Vite（45273）を起動し、インストール済みの
  Microsoft Edge（なければ Chrome）をヘッドレスで操作する。起動中の本番アプリ（48000/45173）とは衝突しない。
- 画像の読み込み（D&D）、Workspace の処理フロー（選択・複数選択・拡大表示・パンとズーム・アーカイブの切り替え）、
  まとめて実行（1 枚失敗のまとめ通知と失敗の印）、再実行のスタックと候補の切り替え、コマ結合の差し替え、原画との比較（生成画像のクリックで開くウィンドウ。Parallel、Slider の境界線・Transpose・Flip、Overlay の上絵の移動）、各ツールの設定画面と
  JSON プレビュー、プロンプトの登録・呼び出しと Prompt Manager（編集・並べ替え・カテゴリー・エクスポート / インポート）、Character Manager（画像の追加・並べ替え・削除、アイコンの切り取り、複製、zip のエクスポート / インポート）と AI画像生成からの呼び出し、未実装ツールのエラー記録、後続ごとの削除とアーカイブの削除・Undo（順番・競合）、Archive Manager（名前の変更・zip のエクスポートとインポート・開く・削除と Undo）と Workspace の画像の書き出し、設定ウィンドウ、上部バーを順に実行する。
- 出力: `frontend/e2e/.output/latest/` に `observations.json`（各シナリオの UI 状態・キャンバスの画素サンプル）と
  スクリーンショット（`NN-*.png`）。エージェントは画像を開いて直接確認できる。
- 時刻は `2026-01-01 10:00:00` に固定され、`observations.json` 内のタイムスタンプは `<STAMP>` / `<DATETIME>` に置換される。
  リファクタリング前後で `observations.json` を比較すれば振る舞いの差分を検出できる。
- オプション: `--headed`（ブラウザを表示）, `--keep`（一時データを残す）, `--out <dir>`, `--backend-port`, `--frontend-port`, `--root`, `--python`。
- **一部だけ回す**: `npm run e2e -- --only 12,14` で、名前が `12`・`14` で始まるシナリオだけを実行する（例: コマ割りなら `12`、削除なら `14`）。
  後のシナリオが使う準備のシナリオ（`smoke.mts` の `SETUP_STEPS`: 01-boot・03-import-image・12-merge-panels）は常に一緒に実行する。
  シナリオは前のシナリオの結果の上で動くので、それ以外の前提があるシナリオは単独では失敗することがある（その時は前提のシナリオも `--only` に足す）。
- **最初の失敗で止まる**: 1 本が失敗すると、残りは実行せずに `observations.json` に `skipped` と記録する（失敗した画面のまま進むと、
  後ろのシナリオが 1 本ずつ 30 秒待って失敗し、時間だけかかるため）。全部回したい時は `--keep-going`。
- 各シナリオの所要時間を `[e2e] <名前> ok (<秒>s)` と出す。
- `POST /api/local-files/pick-image`（ファイル選択ダイアログ）は常にブラウザ側で差し替える。シナリオは `stubFileDialog` で答えを決め、
  差し替えていない呼び出しはエラーになる（実際のダイアログは開かない）。
- 新しい UI を追加したら、その操作をシナリオに追加する。
