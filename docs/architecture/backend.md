# バックエンド設計

FastAPI（Python 3.11+、uv 管理）。起動: `cd backend && uv run python -m uvicorn src.app.main:app --port 48000`

## ディレクトリとレイヤー

```text
backend/src/app/
├── main.py          # create_app(): CORS, 例外ハンドラー, ルーター登録（全ルートは /api 配下）
├── config.py        # パス・環境変数の唯一の定義。.env を os.environ に読み込む（GEMINI_API_KEY は除く）
├── errors.py        # AppError 階層と unexpected_errors_as()
├── routers/         # HTTP 層。入力を受けてサービスを呼ぶだけ（try/except を書かない）
├── services/        # 業務ロジック。FastAPI に依存しない
│   ├── archive_service.py   # アーカイブ（フォルダ）の読み書き・ゴミ箱・パス検証
│   ├── panel_service.py     # コマ分割（Gemini 呼び出し + 切り出し + 保存）
│   ├── panel_geometry.py    # コマ分割の純粋関数（プロンプト・座標変換・レスポンス解析）
│   ├── merge_service.py     # コマ結合
│   ├── generation_service.py# 画像生成（プロバイダー選択）
│   ├── image_service.py     # rembg 背景除去（初回呼び出し時に import）
│   ├── secret_store.py      # Gemini API キーの保存・読み出し（今は .env。Web 版では利用者ごとの暗号化保存に差し替える）
│   ├── settings_service.py  # ツール設定(JSON)
│   ├── prompt_service.py    # 登録したプロンプト（ツールごと、settings/prompts.json）
│   ├── file_dialog_service.py # バックエンドの PC のファイル選択ダイアログ（tkinter。画像読み込み）
│   ├── json_file.py         # settings/ の JSON の読み書き（壊れたファイルの退避・一時ファイル経由の書き込み）
│   └── system_service.py    # シャットダウン
└── providers/       # 外部 AI の差し替え層
    ├── base.py      # ImageGenerationProvider（generate_multimodal、api = interactions / generate_content）
    ├── gemini.py    # Gemini API（Interactions / generateContent）、GeminiAPIError、GeminiNoImageError
    └── gemini_reasons.py # 画像のない応答（ブロック・除外）を日本語で説明する
```

- 依存方向: routers → services → providers / config / errors。services は routers を import しない。
- 時間のかかる同期処理（rembg, Gemini への HTTP, Pillow）は `run_in_threadpool` で実行し、ヘルスチェック等を止めない。

## エラー処理
- サービスは `AppError` のサブクラスを投げる。`main.py` が `{"detail": exc.detail}` と `status_code` に変換する。
  - `BadRequestError`(400) / `NotFoundError`(404) / `AppError`(500)
  - `GeminiNoImageError`(422): Gemini は応答したが画像がない（ブロック・除外）。サーバーの故障ではないので 5xx にしない。
  - `raw_response` を持つ場合 `detail` は `{"message": ..., "raw_response": ...}`
- **メッセージは日本語で書き、そのままユーザーに見せる。** 例外の文言や外部 API の応答（Gemini のセーフティブロック等）は
  メッセージに埋め込まず `raw_response` に入れる（フロントのエラートーストに「原文」として出る。[specs/notifications.md](../specs/notifications.md)）。
  例: `raise ArchiveServiceError("アーカイブに保存できませんでした。", raw_response=exception_text(e)) from e`
- 想定外の例外は 500 `{"detail": {"message": "バックエンドで予期しないエラーが発生しました。", "raw_response": "<型>: <内容>"}}`。
  処理名を付けたい場合はルーターで `with unexpected_errors_as("コマ分割の処理中にエラーが発生しました。"):`。
- フロントは `shared/api/http.ts` の `ApiError` でこの形式を解釈する。形式を変える時は両方を直す。
- ログファイル（log.txt / error.txt）は書かない。

## ツールの結果の保存
- 結果は必ず `archive_service.save_result(root, folder_name, files, info)` で書く（仕様: [specs/archives.md](../specs/archives.md)「ツールの結果の保存」）。
  root のトップレベルの中（root なしなら新しいアーカイブ）に一意な名前のフォルダを作り、info があれば info.json を付ける。
  コマ分割・コマ結合はサービスから直接、フロントで保存するツールは `POST /archives/results` 経由で呼ぶ。

## 設定（`config.py`）

| 環境変数 | 既定値 | 用途 |
|---|---|---|
| `CONFEITO_ENV_FILE` | `<repo>/.env` | 起動時に os.environ へ読み込む（既存の環境変数が優先。`GEMINI_API_KEY` は読み込まず secret_store が毎回ファイルから読む） |
| `CONFEITO_ARCHIVES_DIR` | `<repo>/archives` | アーカイブ保存先（ゴミ箱 `.trash/` を含む。`.trash/` は起動時に `main.py` の lifespan が `archive_service.empty_trash` で空にする） |
| `CONFEITO_SETTINGS_DIR` | `<repo>/settings` | `default_settings.json`（初期設定）、`user_settings.json`（ユーザー設定）、`prompts.json`（登録したプロンプト） |
| `GEMINI_API_KEY` | （.env） | Gemini API キー（`services/secret_store.py` だけが読み書きする）。優先順: リクエストの `X-API-Key` ヘッダー → .env → 環境変数。アプリは環境変数を書き換えない |
| `CONFEITO_PROJECT_DIR` | `<repo>` | 画像読み込みのファイル選択ダイアログを、フォルダの指定がない時に開く場所 |
| `CONFEITO_MODELS_DIR` | `<repo>/models` | rembg モデルの場所。起動時に `U2NET_HOME` の既定値にする（.env に書く必要はない） |
| `U2NET_HOME` | （未設定） | 環境変数か .env で指定した場合はそちらが優先（.env の相対パスは .env の場所基準） |

## API 一覧（すべて `/api` 配下）

| メソッド | パス | 用途 / フロントの呼び出し元 |
|---|---|---|
| GET | `/health` | 起動待ち・ステータスバー (`api/system.ts`) |
| POST | `/shutdown` | 全タブクローズ時に Vite プラグインが呼ぶ |
| GET | `/archives` | トップレベル一覧（新しい順） |
| POST | `/archives` | multipart: `name`, `files[]`, `paths[]` で保存（既存なら追記・上書き） |
| POST | `/archives/results` | ツールの結果を保存: multipart `root?`, `name`, `info?`(JSON), `files[]`, `paths[]` → `{folder}`（`save_result`。同名は `_2`…、info.json を付ける） |
| GET | `/archives/{name}/contents` | 配下の全フォルダ・ファイル（`folderId` で親子） |
| GET | `/archives/{name}/extract?path=` | ファイル本体 |
| DELETE | `/archives/{name}` | `.trash/` へ移動 |
| POST | `/archives/{name}/restore` | `.trash/` から復元（同じ名前のアーカイブがあれば 409、置き換えない） |
| POST | `/archives/{name}/delete_contents` | `{paths}` を `.trash/.items/{name}/` へ移動。空になったフォルダ・アーカイブは消す |
| POST | `/archives/{name}/restore_contents` | `{paths}` を `.trash/.items/{name}/` から元の場所へ戻す（Undo。同じ名前のものがあれば 409 で何も移さない） |
| POST | `/image/remove-bg` | 背景除去（[specs/tools/remove-background.md](../specs/tools/remove-background.md)） |
| POST | `/image/split-panels` | コマ分割（[specs/tools/panel-split-merge.md](../specs/tools/panel-split-merge.md)） |
| POST | `/image/split-panels/preview` | コマ分割で Gemini に送るリクエストの確認用 |
| POST | `/image/merge-panels` | コマ結合 |
| POST | `/nano-banana-pro` | 画像生成・Interactions API（応答は画像そのもの） |
| POST | `/nano-banana-pro/generate-content` | 画像生成・generateContent API（応答は上と同じ） |
| POST | `/local-files/check-folder` | `{path}` が絶対パスの既存フォルダか（空欄は可）。違えば 404（画像読み込み） |
| POST | `/local-files/pick-image` | `{initial_dir}`（空欄ならプロジェクトのフォルダ）でファイル選択ダイアログを開く。選んだ画像そのもの（名前は `X-File-Name`、URL エンコード）、キャンセルは 204、ダイアログが開いていれば 400 |
| GET/POST | `/settings/gemini` | API キーの有無 / 保存（secret_store。今は .env。空のキーは 400） |
| GET/POST | `/settings/tools` | ツール設定の取得（初期設定 + ユーザー設定、`{values, warnings}`）/ ユーザー設定への追加・更新（`{values}` を重ねる） |
| GET/POST | `/prompts/{tool}` | 登録したプロンプトの一覧（`{prompts, warnings}`）/ 登録（`{name, text}` → `{prompt, warnings}`。同名は 400） |
| PUT/DELETE | `/prompts/{tool}/{id}` | 登録したプロンプトの更新（`{name, text}` → `{prompt, warnings}`）/ 削除（`{warnings}`）。ない id は 404 |

## Gemini プロバイダー（`providers/gemini.py`）
- 画像生成は Interactions API（`/v1beta/interactions`）または `models/{model}:generateContent`（どちらもタイムアウト 600 秒）。
  コマ検出は `models/{model}:generateContent`（90 秒）。
- 画像生成の応答の Content-Type は、Gemini が返した画像の MIME タイプ
  （不明ならバイト列から判定、それも不明なら要求した `mime_type`、既定 `image/png`）。
- generateContent の画像は、最初に画像を含む候補の「思考ではない（`thought` が true でない）」最後の `inlineData`。
  `promptFeedback.blockReason` があるとき、画像がないときは `GeminiNoImageError`（422）。Interactions API で画像がない・`status` が
  `completed` でないときも同じ。メッセージと `raw_response` は `gemini_reasons.py` が作る（[specs/tools/gemini-image.md](../specs/tools/gemini-image.md)「画像が生成されなかった時」）。
- API キーは `x-goog-api-key` ヘッダーで送る（URL に載せない）。
- `gemini-3-pro-image` にはメディアごとの解像度指定（`resolution`）を付けない（400 エラーになる）。
- Gemini が 200 以外を返したら「Gemini API がエラーを返しました（HTTP <status>）。」とし、エラー本文を `raw_response` に入れる。
  "high demand" のときは日本語の補足を付ける。API キー未設定は `MISSING_API_KEY_MESSAGE`（コマ分割と共通。どちらも 400）。
- リクエストモデルは宣言した項目だけを Gemini に送り、それ以外のトップレベル項目は捨てる。
  - `NanoBananaProRequest`（Interactions）: `model` / `input` / `response_format` / `generation_config` /
    `system_instruction` / `tools` / `store` / `service_tier`。
  - `GenerateContentRequest`: `model`（URL に移す）/ `contents` / `generationConfig` / `safetySettings` /
    `systemInstruction` / `tools` / `serviceTier` / `store`。

## 実装手順: エンドポイントを追加する
1. ロジックを `services/<領域>.py` に書く。失敗は `AppError` 系で投げる（必要ならサービス固有のサブクラスを定義）。
2. `routers/<領域>.py` に薄いハンドラーを追加（ブロッキング処理は `run_in_threadpool`）。新しいルーターは `main.py` の登録ループに追加。
3. `tests/` にテストを追加（[testing.md](./testing.md)）。フロントは `shared/api/` に型付き関数を追加し、上の表を更新する。
