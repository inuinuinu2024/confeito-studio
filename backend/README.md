# ConfeitO Studio Backend

FastAPI 製のローカル API サーバー。設計は [docs/architecture/backend.md](../docs/architecture/backend.md) を参照。

## セットアップ

```bash
cd backend
uv sync            # 本体 + 開発用（pytest, ruff, httpx2）
```

## 起動

```bash
uv run python -m uvicorn src.app.main:app --reload --port 48000
```

日常利用では `setup/start-app.ps1` がフロントエンドと一緒に起動する（`--reload` なし）。

## 検証

```bash
uv run pytest                 # tests/ — 一時ディレクトリで実行され、実データ・API キーに触れない
uv run ruff check .
uv run ruff format --check .  # 整形は uv run ruff format .
```

## 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `GEMINI_API_KEY` | （`.env`） | Gemini API キー。設定画面から `.env` に保存できる |
| `CONFEITO_ENV_FILE` | `<repo>/.env` | 起動時に読み込む .env |
| `CONFEITO_ARCHIVES_DIR` | `<repo>/archives` | アーカイブ保存先 |
| `CONFEITO_SETTINGS_DIR` | `<repo>/settings` | ツール設定（初期設定 `default_settings.json`、ユーザー設定 `user_settings.json`） |
| `CONFEITO_ASSETS_DIR` | `<repo>/assets` | ユーザーの素材。登録したプロンプト（`prompts/prompts.json`）、登録したキャラクター（`characters/`） |
| `CONFEITO_MODELS_DIR` | `<repo>/models` | rembg のモデルと、アニメ顔検出のモデル（初回使用時に自動でダウンロード）の置き場（`.env` に書く必要はない） |
| `U2NET_HOME` | （未設定） | 設定した場合はこちらが優先（rembg 本来の変数。`.env` の相対パスは .env の場所基準） |
