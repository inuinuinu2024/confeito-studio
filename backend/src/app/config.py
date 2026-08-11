"""Application configuration via environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    設定値は環境変数または .env ファイルから読み込まれる。

    例:
        CONFEITO_API_PORT=8000
        CONFEITO_COMFYUI_URL=http://127.0.0.1:8188
    """

    # Server
    api_port: int = 8000
    api_host: str = "127.0.0.1"



    # Project workspace — PSD保存先のベースディレクトリ
    workspace_dir: str = "./workspace"

    model_config = {
        "env_prefix": "CONFEITO_",
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


settings = Settings()
