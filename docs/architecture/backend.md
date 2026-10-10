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
│   ├── archive_service.py   # アーカイブ（フォルダ）の読み書き・表示名（.archive.json）・ゴミ箱・パス検証
│   ├── archive_transfer.py  # アーカイブの zip のエクスポート / インポート（キーの書き換え）と画像の書き出し（zip）
│   ├── flow_service.py      # Workspace の処理フロー（開始画像・結果フォルダの info.json・.flow.json の表示中の候補）とサムネイル、Archive Manager の一覧（archive_summaries）
│   ├── panel_service.py     # コマ分割（Gemini 呼び出し + 切り出し + 保存）
│   ├── panel_geometry.py    # コマ分割の純粋関数（プロンプト・座標変換・レスポンス解析）
│   ├── merge_service.py     # コマ結合（コマの差し替え overrides を含む）
│   ├── generation_service.py# 画像生成（プロバイダー選択）
│   ├── image_service.py     # rembg 背景除去（初回呼び出し時に import）
│   ├── secret_store.py      # Gemini API キーの保存・読み出し（今は .env。Web 版では利用者ごとの暗号化保存に差し替える）
│   ├── settings_service.py  # ツール設定(JSON)
│   ├── archives_location.py # アーカイブのフォルダ（既定 / ユーザーが選んだフォルダ。起動時に読み、settings.use_archives_dir で切り替える）
│   ├── categorized_store.py # カテゴリー付きの一覧の共通処理（並べ替え・カテゴリー名の変更・名前の一意チェック）
│   ├── prompt_service.py    # 登録したプロンプト（全ツール共通、assets/prompts/prompts.json）
│   ├── character_service.py # 登録したキャラクターと画像・アイコン（全ツール共通、assets/characters/。zip のエクスポート / インポート）
│   ├── usage_service.py     # Gemini の利用記録（応答からトークン数を取り出し、額を計算して記録する。Cost Monitor）
│   ├── usage_store.py       # 利用記録の保存と集計（SQLite data/usage.db。Web 版ではサーバーの DB に差し替える）
│   ├── pricing.py           # Gemini の単価表（USD / 1M トークン、適用開始日・service tier ごと）と額の計算
│   ├── face_service.py      # アニメ顔検出（YOLOv8s ONNX。初回使用時に models/ へダウンロード）
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
| `CONFEITO_ARCHIVES_DIR` | `<repo>/archives` | アーカイブの既定の保存先（`settings.default_archives_dir`）。ユーザーが「保存先」で選んだフォルダがあればそちらを使う（`settings.archives_dir` が使用中のフォルダ。`archives_location.py`）。ゴミ箱 `.trash/` はその中にあり、起動時に `main.py` の lifespan が `archive_service.empty_trash` で空にする |
| `CONFEITO_SETTINGS_DIR` | `<repo>/settings` | `default_settings.json`（初期設定）、`user_settings.json`（ユーザー設定） |
| `CONFEITO_ASSETS_DIR` | `<repo>/assets` | `prompts/prompts.json`（登録したプロンプト）、`characters/`（登録したキャラクターと画像） |
| `CONFEITO_DATA_DIR` | `<repo>/data` | アプリが自分で付ける記録。`usage.db`（Cost Monitor の Gemini の利用記録、SQLite） |
| `GEMINI_API_KEY` | （.env） | Gemini API キー（`services/secret_store.py` だけが読み書きする）。優先順: リクエストの `X-API-Key` ヘッダー → .env → 環境変数。アプリは環境変数を書き換えない |
| `CONFEITO_PROJECT_DIR` | `<repo>` | 画像読み込みのファイル選択ダイアログを、フォルダの指定がない時に開く場所 |
| `CONFEITO_MODELS_DIR` | `<repo>/models` | rembg モデルの場所。起動時に `U2NET_HOME` の既定値にする（.env に書く必要はない） |
| `U2NET_HOME` | （未設定） | 環境変数か .env で指定した場合はそちらが優先（.env の相対パスは .env の場所基準） |

## API 一覧（すべて `/api` 配下）

| メソッド | パス | 用途 / フロントの呼び出し元 |
|---|---|---|
| GET | `/health` | 起動待ち・ステータスバー (`api/system.ts`) |
| POST | `/shutdown` | 全タブクローズ時に Vite プラグインが呼ぶ |
| GET | `/archives` | トップレベル一覧（新しい順。`key` = フォルダ名、`name` = 表示名） |
| GET | `/archives/details` | Archive Manager の一覧 `[{key, name, created_at, timestamp, images, results, size, cover}]`（新しい順。`flow_service.archive_summaries`） |
| PUT | `/archives/{name}/meta` | `{name}`: 表示名を変える（`.archive.json`。フォルダ名は変えない。同じ表示名があれば 409）→ `{name, created_at}` |
| POST | `/archives/export` | `{names}`: アーカイブの zip（`manifest.json` ＋ フォルダごと）。ファイル名は `X-File-Name`（URL エンコード）。一時ファイルを送って消す |
| POST | `/archives/import` | multipart `file`（zip）: 中のアーカイブを新しいアーカイブとして追加 → `{imported: [{key, name}], skipped_files, warnings}`。読めない zip は 400 |
| POST | `/archives/export-images` | `{keys}`: 画像をフォルダなしで並べた zip（名前は `<結果フォルダ>_<ファイル名>`、重なれば `_2`）。ファイル名は `X-File-Name` |
| POST | `/archives` | multipart: `name`, `files[]`, `paths[]` で保存（既存なら追記・上書き） |
| POST | `/archives/results` | ツールの結果を保存: multipart `root?`, `name`, `info?`(JSON), `files[]`, `paths[]` → `{folder, archive_name}`（`save_result`。同名は `_2`…、info.json を付ける。新しいアーカイブには `.archive.json`。`archive_name` は表示名） |
| GET | `/archives/{name}/contents` | 配下の全フォルダ・ファイル（`folderId` で親子。`.flow.json`・`.archive.json` は含めない） |
| GET | `/archives/{name}/flow` | Workspace の処理フロー `{archive, roots, runs, selection}`。roots = 直下の画像、runs = 直下の結果フォルダ（info.json の `tool`/`created_at`/`source`/`sources`/`settings` と、直下の画像 `outputs[{key,name,width,height}]`。古い順）、selection = `.flow.json` の表示中の候補、merge = コマ結合に使う画像のマーク |
| PUT | `/archives/{name}/flow/selection` | `{stack, folder}`: スタックの表示中の候補を `.flow.json` に保存（`folder: null` で既定 = 最新に戻す） |
| PUT | `/archives/{name}/flow/merge` | `{panel, image}`: コマ結合でコマ `panel` に貼る画像のマークを `.flow.json` に保存（`image: null` でマークを外す = 原画） |
| GET | `/archives/{name}/thumbnail?path=&size=` | 画像の縮小コピー（長辺 `size` px、32〜1024。透過ありは PNG、なしは JPEG）。画像でない・ない時は 404 |
| GET | `/archives/{name}/extract?path=` | ファイル本体 |
| DELETE | `/archives/{name}` | `.trash/` へ移動 |
| POST | `/archives/{name}/restore` | `.trash/` から復元（同じ名前のアーカイブがあれば 409、置き換えない） |
| POST | `/archives/{name}/delete_contents` | `{paths}` を `.trash/.items/{name}/` へ移動。空になったフォルダ・アーカイブは消す |
| POST | `/archives/{name}/restore_contents` | `{paths}` を `.trash/.items/{name}/` から元の場所へ戻す（Undo。同じ名前のものがあれば 409 で何も移さない） |
| POST | `/image/remove-bg` | 背景除去（[specs/tools/remove-background.md](../specs/tools/remove-background.md)） |
| POST | `/image/split-panels` | コマ分割（[specs/tools/panel-split-merge.md](../specs/tools/panel-split-merge.md)） |
| POST | `/image/split-panels/preview` | コマ分割で Gemini に送るリクエストの確認用 |
| POST | `/image/recrop-panel` | コマの切り直し。form `panel_key`（コマ分割の結果のコマのキー）、`box`（JSON `[xmin, ymin, xmax, ymax]`、分割前のページの画素） |
| POST | `/image/merge-panels` | コマ結合。form `target_folder`（コマ分割の結果フォルダ）、`overrides?`（JSON `{コマのファイル名: 差し替える画像のキー}`）、`boxes?`（JSON `{コマのファイル名: 切り直した範囲}`） |
| POST | `/nano-banana-pro` | 画像生成・Interactions API（応答は画像そのもの） |
| POST | `/nano-banana-pro/generate-content` | 画像生成・generateContent API（応答は上と同じ） |
| POST | `/local-files/check-folder` | `{path}` が絶対パスの既存フォルダか（空欄は可）。違えば 404（画像読み込み） |
| POST | `/local-files/pick-folder` | `{initial_dir}` でフォルダ選択ダイアログを開く → `{path}`（キャンセルは null）（保存先） |
| POST | `/local-files/pick-image` | `{initial_dir}`（空欄ならプロジェクトのフォルダ）でファイル選択ダイアログを開く。選んだ画像そのもの（名前は `X-File-Name`、URL エンコード）、キャンセルは 204、ダイアログが開いていれば 400 |
| GET | `/usage/summary?now_ms&tz_offset_minutes&range` | Cost Monitor の集計 `{periods: {today, month, range}, range, latest, daily, by_tool, by_model, warnings, prices_checked_on}`（`range` = 7d / 30d / 90d / month / all。見ている人の暦日・暦月で区切る） |
| GET | `/usage/day?date&tz_offset_minutes` | 1 日の内訳 `{day, total, by_tool, by_model, records, warnings}`（`date` = YYYY-MM-DD） |
| GET | `/usage/records?offset&limit` | 利用記録を新しい順に 1 ページ `{records, total, warnings}`（`limit` ≤ 200）。仕様は [specs/cost-monitor.md](../specs/cost-monitor.md) |
| GET/POST | `/settings/archives` | アーカイブのフォルダの状態 `{path, default_path, is_default, exists, ignored}` / 切り替え `{path, create}`（"" = 既定。ない時は `missing: true` で変えない。指定できないフォルダは 400。中身は移さない） |
| GET/POST | `/settings/gemini` | API キーの有無 / 保存（secret_store。今は .env。空のキーは 400） |
| GET/POST | `/settings/tools` | ツール設定の取得（初期設定 + ユーザー設定、`{values, warnings}`）/ ユーザー設定への追加・更新（`{values}` を重ねる） |
| GET/POST | `/prompts` | 登録したプロンプトの一覧（`{categories, prompts, warnings}`）/ 作成（`{name, category, text}` → `{prompt, warnings}`。同名は 400） |
| PUT/DELETE | `/prompts/{id}` | 更新（`{name, category, text}` → `{prompt, warnings}`）/ 削除（`{warnings}`）。ない id は 404 |
| POST | `/prompts/{id}/duplicate` | 元の直後に「<名前> のコピー」を作る（`{prompt, warnings}`） |
| PUT | `/prompts/{id}/category` | `{category}` の末尾へ移す（`{prompt, warnings}`） |
| PUT | `/prompts/order` / `/prompts/categories/order` | カテゴリーの中のプロンプトの順（`{category, ids}`）/ カテゴリーの順（`{categories}`）。今の内容と合わなければ 409 |
| POST | `/prompts/categories/rename` | `{old, new}` カテゴリー名の変更（既存の名前・空なら統合） |
| POST | `/prompts/import` | `{prompts, categories, on_conflict}` を追加（`{added, overwritten, skipped, invalid, warnings}`）。仕様は [specs/prompt-manager.md](../specs/prompt-manager.md) |
| GET/POST | `/characters` | 登録したキャラクターの一覧（`{categories, characters, warnings}`）/ 作成（multipart: `data` = `{name, category, text, images}` ＋ `files`。同名は 400） |
| PUT/DELETE | `/characters/{id}` | 更新（POST と同じ形。`images` にない保存済みの画像は消える）/ 削除（フォルダごと）。ない id は 404 |
| POST / PUT | `/characters/{id}/duplicate` / `/characters/{id}/category` | 画像ごと複製 / `{category}` の末尾へ移す |
| GET | `/characters/{id}/images/{file}` | キャラクターの画像（そのキャラクターの `images` にないファイルは 404） |
| GET | `/characters/{id}/icon` | キャラクターのアイコン（256×256 PNG。ない時は 404）。作成・更新の `data.icon` は `keep` / `none` / `upload`（multipart の `icon`） |
| POST | `/characters/detect-faces` | multipart `image` のアニメ顔 `{faces: [{x, y, width, height, score}]}`。モデルを取得できない時は 502 |
| PUT / POST | `/characters/order` / `/characters/categories/order` / `/characters/categories/rename` | 並べ替え・カテゴリー名の変更（プロンプトと同じ形） |
| GET / POST | `/characters/export` / `/characters/import/preview` / `/characters/import` | zip の書き出し / 読み込む前の確認（`{count, conflicts, invalid}`）/ 読み込み（`file` ＋ `on_conflict`）。仕様は [specs/character-manager.md](../specs/character-manager.md) |

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
