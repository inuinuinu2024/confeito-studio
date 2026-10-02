# バックエンド設計

FastAPI（Python 3.11+、uv 管理）。起動: `cd backend && uv run python -m uvicorn src.app.main:app --port 48000`

## ディレクトリとレイヤー

```text
backend/src/app/
├── main.py          # create_app(): CORS, 例外ハンドラー, ルーター登録（全ルートは /api 配下）
├── config.py        # パス・環境変数の唯一の定義。.env を os.environ に読み込む
├── errors.py        # AppError 階層と unexpected_errors_as()
├── routers/         # HTTP 層。入力を受けてサービスを呼ぶだけ（try/except を書かない）
├── services/        # 業務ロジック。FastAPI に依存しない
│   ├── archive_service.py   # アーカイブ（フォルダ）の読み書き・ゴミ箱・パス検証
│   ├── panel_service.py     # コマ分割（Gemini 呼び出し + 切り出し + 保存）
│   ├── panel_geometry.py    # コマ分割の純粋関数（プロンプト・座標変換・レスポンス解析）
│   ├── merge_service.py     # コマ結合
│   ├── generation_service.py# 画像生成（プロバイダー選択）
│   ├── image_service.py     # rembg 背景除去（初回呼び出し時に import）
│   ├── settings_service.py  # API キー(.env) とツール設定(JSON)
│   └── system_service.py    # シャットダウン
└── providers/       # 外部 AI の差し替え層
    ├── base.py      # ImageGenerationProvider（generate_multimodal、api = interactions / generate_content）
    └── gemini.py    # Gemini API（Interactions / generateContent）、GeminiAPIError
```

- 依存方向: routers → services → providers / config / errors。services は routers を import しない。
- 時間のかかる同期処理（rembg, Gemini への HTTP, Pillow）は `run_in_threadpool` で実行し、ヘルスチェック等を止めない。

## エラー処理
- サービスは `AppError` のサブクラスを投げる。`main.py` が `{"detail": exc.detail}` と `status_code` に変換する。
  - `BadRequestError`(400) / `NotFoundError`(404) / `AppError`(500)
  - `raw_response` を持つ場合 `detail` は `{"message": ..., "raw_response": ...}`（Gemini のセーフティブロック等をフロントまで伝える）
- 想定外の例外は 500 `{"detail": str(exc)}`。ツール名を付けたい場合はルーターで `with unexpected_errors_as("コマ分割処理中にエラーが発生しました"):`。
- フロントは `shared/api/http.ts` の `ApiError` でこの形式を解釈する。形式を変える時は両方を直す。

## 設定（`config.py`）

| 環境変数 | 既定値 | 用途 |
|---|---|---|
| `CONFEITO_ENV_FILE` | `<repo>/.env` | 起動時に os.environ へ読み込む（既存の環境変数が優先） |
| `CONFEITO_ARCHIVES_DIR` | `<repo>/archives` | アーカイブ保存先（ゴミ箱 `.trash/` を含む） |
| `CONFEITO_SETTINGS_DIR` | `<repo>/settings` | `default_prompts.json` |
| `GEMINI_API_KEY` | （.env） | Gemini API キー。リクエストの `X-API-Key` ヘッダーが優先 |
| `U2NET_HOME` | （.env, `models`） | rembg モデルの場所（相対パスはリポジトリ基準） |

## API 一覧（すべて `/api` 配下）

| メソッド | パス | 用途 / フロントの呼び出し元 |
|---|---|---|
| GET | `/health` | 起動待ち・ステータスバー (`api/system.ts`) |
| POST | `/shutdown` | 全タブクローズ時に Vite プラグインが呼ぶ |
| GET | `/archives` | トップレベル一覧（新しい順） |
| POST | `/archives` | multipart: `name`, `files[]`, `paths[]` で保存（既存なら追記・上書き） |
| GET | `/archives/{name}/contents` | 配下の全フォルダ・ファイル（`folderId` で親子） |
| GET | `/archives/{name}/extract?path=` | ファイル本体 |
| DELETE | `/archives/{name}` | `.trash/` へ移動 |
| POST | `/archives/{name}/restore` | `.trash/` から復元 |
| POST | `/archives/{name}/delete_contents` | `{paths}` を `.trash/.items/{name}/` へ移動。空になったフォルダ・アーカイブは消す |
| POST | `/archives/{name}/restore_contents` | `{paths}` を `.trash/.items/{name}/` から元の場所へ戻す（Undo） |
| POST | `/archives/{name}/log` | `{message, file_name="log.txt"}` を追記 |
| POST | `/image/remove-bg` | 背景除去（[specs/tools/remove-background.md](../specs/tools/remove-background.md)） |
| POST | `/image/split-panels` | コマ分割（[specs/tools/panel-split-merge.md](../specs/tools/panel-split-merge.md)） |
| POST | `/image/split-panels/preview` | コマ分割で Gemini に送るリクエストの確認用 |
| POST | `/image/merge-panels` | コマ結合 |
| POST | `/nano-banana-pro` | 画像生成・Interactions API（応答は画像そのもの） |
| POST | `/nano-banana-pro/generate-content` | 画像生成・generateContent API（応答は上と同じ） |
| GET/POST | `/settings/gemini` | API キーの有無 / 保存（.env） |
| GET/POST | `/settings/prompts` | ツール設定マップ全体の取得 / 置換 |

## Gemini プロバイダー（`providers/gemini.py`）
- 画像生成は Interactions API（`/v1beta/interactions`）または `models/{model}:generateContent`（どちらもタイムアウト 600 秒）。
  コマ検出は `models/{model}:generateContent`（90 秒）。
- 画像生成の応答の Content-Type は、Gemini が返した画像の MIME タイプ
  （不明ならバイト列から判定、それも不明なら要求した `mime_type`、既定 `image/png`）。
- generateContent の画像は、最初に画像を含む候補の「思考ではない（`thought` が true でない）」最後の `inlineData`。
  `promptFeedback.blockReason` があるとき、画像がないとき（`finishReason` を表示）は `raw_response` 付きのエラーにする。
- API キーは `x-goog-api-key` ヘッダーで送る（URL に載せない）。
- `gemini-3-pro-image` にはメディアごとの解像度指定（`resolution`）を付けない（400 エラーになる）。
- "high demand" エラーには日本語の補足を付ける。エラー本文は `raw_response` として保持し上位へ伝える。
- リクエストモデルは宣言した項目だけを Gemini に送り、それ以外のトップレベル項目は捨てる。
  - `NanoBananaProRequest`（Interactions）: `model` / `input` / `response_format` / `generation_config` /
    `system_instruction` / `tools` / `store` / `service_tier`。
  - `GenerateContentRequest`: `model`（URL に移す）/ `contents` / `generationConfig` / `safetySettings` /
    `systemInstruction` / `tools` / `serviceTier` / `store`。

## 実装手順: エンドポイントを追加する
1. ロジックを `services/<領域>.py` に書く。失敗は `AppError` 系で投げる（必要ならサービス固有のサブクラスを定義）。
2. `routers/<領域>.py` に薄いハンドラーを追加（ブロッキング処理は `run_in_threadpool`）。新しいルーターは `main.py` の登録ループに追加。
3. `tests/` にテストを追加（[testing.md](./testing.md)）。フロントは `shared/api/` に型付き関数を追加し、上の表を更新する。
