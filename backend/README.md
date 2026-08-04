# Confeito-Studio Backend

Confeito-Studio のバックエンドサーバー。

## 技術スタック

- **Python 3.11+**
- **FastAPI** — Web フレームワーク
- **uvicorn** — ASGI サーバー
- **psd-tools** — PSD ファイル処理
- **uv** — パッケージ管理

## セットアップ

```bash
cd backend
uv sync
```

## 起動

```bash
uv run uvicorn src.app.main:app --reload --port 8000
```

## API エンドポイント

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/health` | ヘルスチェック |

## 環境変数

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `CONFEITO_API_PORT` | `8000` | サーバーポート |
| `CONFEITO_API_HOST` | `127.0.0.1` | サーバーホスト |
| `CONFEITO_COMFYUI_URL` | `http://127.0.0.1:8188` | ComfyUI 接続先 |
| `CONFEITO_WORKSPACE_DIR` | `./workspace` | PSD保存先ディレクトリ |

## アーキテクチャ

```
src/app/
├── main.py          # FastAPI アプリケーション
├── config.py        # 設定（環境変数）
├── providers/       # 生成AIプロバイダー（プロバイダーパターン）
│   └── base.py      # 抽象基底クラス
└── routers/         # APIルーター
    └── health.py    # ヘルスチェック
```
