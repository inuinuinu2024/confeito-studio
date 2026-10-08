# ConfeitO Studio — AI エージェント向けガイド

リポジトリ直下のこの `AGENTS.md` は、Claude Code（v2.1.277 以降）と Antigravity がどちらも自動で読み込む共通の作業ガイド。
作業の進め方とルールだけを書き、開発履歴・変更ログは書かない。

## プロジェクト
漫画ページの着彩・加工をローカルで行うデスクトップ風 Web アプリ。
- `frontend/`: Vite + TypeScript（UI フレームワークなし、DOM API で組み立て）
- `backend/`: FastAPI。アーカイブ（`archives/` 配下のフォルダ）の保存、Gemini API の中継、rembg 背景除去、コマ分割・結合
- 起動は `setup/start-app.ps1`（backend :48000 / frontend :45173）。全タブを閉じると両方終了する。

## 最初に読むもの
1. [docs/architecture/README.md](docs/architecture/README.md) — 全体像、ポート、データの置き場所
2. 触る側の設計: [frontend.md](docs/architecture/frontend.md) / [backend.md](docs/architecture/backend.md)（構造・イベント一覧・API 一覧・追加手順）
3. 触る機能の仕様: [docs/specs/](docs/specs/README.md)（該当ファイルだけ読めばよい）
4. 検証方法: [docs/architecture/testing.md](docs/architecture/testing.md)

## コマンド
| 目的 | コマンド |
|---|---|
| 依存の導入 | `cd frontend && npm install` / `cd backend && uv sync` |
| 開発起動 | `cd backend && uv run python -m uvicorn src.app.main:app --reload --port 48000` と `cd frontend && npm run dev` |
| フロント検証 | `cd frontend && npm run check`（型検査 + 整形チェック + vitest + ビルド） |
| バックエンド検証 | `cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check .` |
| 画面の検証 | `cd frontend && npm run e2e`（実ブラウザ。結果は `frontend/e2e/.output/latest/`） |
| 整形 | `cd frontend && npm run format` / `cd backend && uv run ruff format .` |

## ルール
1. **指示にわからない点があれば、推測で進めず聞き返して仕様を固める。** 解釈が複数ある・対象や範囲がはっきりしない・既存の仕様と食い違う・
   決まっていない細部（表示・既定値・エラー時の動きなど）が結果を左右する、といった場合は、作業の前に質問する。
   質問には選択肢と推奨案を添え、決まった内容は次のルールに従って記録する。
2. **仕様の決定事項は `docs/specs/` の該当ファイルに記録する。** ユーザーの要望・指摘で仕様が決まった場合は、指示がなくても更新する。
   構造を変えたら `docs/architecture/` の表（イベント一覧・API 一覧など）も更新する。
3. **変更したら検証する。** 上の表の検証を実行し、UI に関わる変更は E2E を回してスクリーンショットを確認する。
   新しい UI 操作を作ったら `frontend/e2e/smoke.mts` にシナリオを足す。
4. **ユーザーのデータを守る。** `archives/`（と「保存先」で指定されたフォルダ）・`.env`・`models/`・`settings/user_settings.json`・`assets/prompts/`・`assets/characters/`・`data/` を削除・上書きしない。テストと E2E は一時ディレクトリを使う。
   E2E は顔検出（`/api/characters/detect-faces`）を必ずスタブにする（スタブしないと `models/` にモデルをダウンロードする）。
   テストや確認で実際の Gemini API を呼ばない（課金と外部送信が発生する）。
5. **フロントエンドの決まり**
   - バックエンド呼び出しは `shared/api/` の関数経由（`fetch` を直接書かない）。
   - 機能間の通知は `shared/events.ts` の `emit` / `on`（`window.dispatchEvent` を直接使わない）。新しいイベントは `AppEventMap` に追加する。
   - 表示モードは `shared/state/view-mode.ts`、表示中のアーカイブ（保存先）と Workspace の選択は `DocumentManager`（ツールは `ToolContext.target` を使う）。
   - アプリの上に開くウィンドウは `shared/ui/window.ts` の `openWindow` で作る（見た目と閉じ方は固定。docs/specs/app-shell.md「別ウィンドウ」）。
   - 通知は `showToast` / `showError`（`alert()` を使わない）。ログファイル（log.txt / error.txt）は書かない（docs/specs/notifications.md）。
   - ブラウザにデータを残さない: localStorage・IndexedDB を使わず、次回も残したい画面の状態は `toolSettings()` 経由で settings/ に保存する（docs/specs/app-shell.md）。
     ツールの設定はウィンドウを開く時に読み、実行開始時に保存する（設定を持つツールは `settingsPrefix` を宣言する）。
   - DOM は `shared/ui/dom.ts` の `h()` と `shared/ui/form.ts` の部品で組み、見た目は CSS クラスで書く（インラインスタイルを増やさない）。
   - `shared/` から `features/` を import しない。純粋なロジックは関数に切り出して `*.test.ts` を書く。
6. **バックエンドの決まり**
   - ルーターは薄く保ち、ロジックは `services/` に置く。失敗は `errors.py` の `AppError` 系を投げる（ルーターで try/except しない）。
     メッセージは日本語で書き、例外の文言や外部 API の応答は `raw_response` に分ける。
   - ファイルパス・環境変数は `config.settings` から取る（`__file__` からパスを組み立てない）。
   - 時間のかかる同期処理は `run_in_threadpool` で実行する。
7. UI の文言とドキュメントは日本語、コードの識別子・コメントは英語。
8. フォーマットは Python が `ruff format`、TypeScript / CSS が Prettier（`frontend/.prettierrc.json`）。
9. **エージェント向けの指示はこのファイルにまとめる。** `CLAUDE.md` や `CLAUDE.local.md` は作らない（あると Claude Code がこのファイルを読まなくなる）。
   `.agents/AGENTS.md` も作らない（Antigravity が内容を二重に読み込む）。

## 作業の入口
| やりたいこと | 場所 |
|---|---|
| AI ツールを追加・修正 | `frontend/src/features/tools/`（一覧は `index.ts`）、手順は frontend.md「ツールを追加する」 |
| 登録プロンプト・Prompt Manager | `features/prompt-manager/`（純粋な処理は `shared/utils/prompts.ts`）、ツール側は `features/tools/gemini-image/prompt-library.ts`、`backend/src/app/services/prompt_service.py`、仕様は docs/specs/prompt-manager.md |
| Gemini に送る内容を変える | `features/tools/gemini-image/`（参照画像・プロンプトの共通部品）、`features/tools/nano-banana-pro/`（モデル・API ごとの設定項目とリクエスト）、`backend/src/app/services/panel_geometry.py`（コマ検出） |
| 登録キャラクター・Character Manager | `features/character-manager/`（純粋な処理は `shared/utils/characters.ts`、アイコンの切り取りは `icon-cropper.ts` と `shared/utils/icon-crop.ts`、顔検出は `backend/src/app/services/face_service.py`）、ツール側は `features/tools/gemini-image/character-picker.ts`、`backend/src/app/services/character_service.py`、仕様は docs/specs/character-manager.md |
| マネージャー共通（カテゴリー一覧・見た目） | `shared/ui/category-sidebar.ts`・`shared/styles/manager.css`・`shared/utils/categories.ts`、`backend/src/app/services/categorized_store.py` |
| Cost Monitor（Gemini の利用料） | `features/cost-monitor/`（系列・金額の表示は `shared/utils/usage.ts`）、記録は `backend/src/app/services/usage_service.py`（Gemini を呼ぶサービスから `record_response`）、保存と集計（SQLite）は `usage_store.py`、単価は `pricing.py`、仕様は docs/specs/cost-monitor.md |
| Workspace（処理フローの表示・選択・削除） | `features/flow-canvas/`（図の組み立て `flow-graph.ts`、配置 `flow-layout.ts`、コマの切り直し `panel-cropper.ts`）、`backend/src/app/services/flow_service.py`（切り直しの保存は `panel_service.recrop_panel`）、仕様は docs/specs/flow-canvas.md |
| まとめて実行（選択した画像へ順に実行） | `features/ai-panel/tool-runner.ts`・`run-targets.ts`、ツールの `targets()`、仕様は docs/specs/ai-panel.md「まとめて実行」 |
| 比較キャンバス（Parallel / Overlay） | `features/canvas/`（描画 `render.ts`、状態 `canvas-state.ts`、ズーム `zoom.ts`） |
| API の追加 | `backend/src/app/routers/` + `services/` → `frontend/src/shared/api/`、手順は backend.md |
| 保存形式・ツールの結果の保存先 | `backend/src/app/services/archive_service.py`（`save_result`）、`frontend/src/features/tools/result.ts`、仕様は docs/specs/archives.md |
| トースト・エラー表示の文言 | `shared/ui/toast.ts`・`shared/utils/error-message.ts`・`ai-panel/tool-runner.ts`、仕様は docs/specs/notifications.md |

## 画面の確認（E2E の出力）
- `npm run e2e` の後、`frontend/e2e/.output/latest/*.png` を画像として開いて画面を確認し、
  `observations.json` で UI の状態（ツリー・キャンバスサイズ・画素サンプル・トースト等）を確認する。
- 振る舞いを変えないリファクタリングでは、変更前後の `observations.json` を比較して差分がないことを確かめる。
  変更前のコードは `git archive HEAD | tar -x -C <dir>` で展開し、`<dir>/frontend/node_modules` を既存のものへリンクして、
  `frontend/` から `npm run e2e -- --root <dir> --python ../backend/.venv/Scripts/python.exe --out <出力先>` で実行できる。

## 注意点
- 開発環境は Windows。Bash（Git Bash）と PowerShell の両方を使える。パスが長いと numba（rembg の依存）のキャッシュ書き込みが失敗するので、
  深い一時ディレクトリで backend を動かす時は `NUMBA_CACHE_DIR` を短いパスにする。
- この PC は Windows の「スマート アプリ コントロール」がオン。電子署名のない Python（uv が自動で入れるもの）は起動時にブロックされる
  （`ImportError: DLL load failed ... アプリケーション制御ポリシーによってこのファイルがブロックされました`）。
  `backend/.venv` は python.org 公式版（`%LOCALAPPDATA%\Programs\Python\Python313`）で作る（手順は setup/README.md）。
- backend の import ルートは `src.app`（`uvicorn src.app.main:app`、テストも `from src.app...`）。
- `settings/default_settings.json` は初期設定（git 管理対象、アプリは書かない）。ユーザーが変えた値は `settings/user_settings.json`、
  ユーザーが登録したプロンプトは `assets/prompts/prompts.json`、キャラクターは `assets/characters/`（全ツール共通）、アプリが自分で付ける記録（Gemini の利用記録 `usage.db`・SQLite）は `data/`（いずれも git 管理外）。
- 未対応の課題・判断待ちの項目はリポジトリ直下の `task.md` にある。
