"""Application configuration.

Every filesystem location used by the backend is defined here; services must not
derive paths from ``__file__``. Each value can be overridden with a ``CONFEITO_*``
environment variable (the tests and the E2E harness point them at temp dirs):

    CONFEITO_ENV_FILE      .env loaded into os.environ at startup (default: <repo>/.env)
    CONFEITO_ARCHIVES_DIR  archive storage (default: <repo>/archives)
    CONFEITO_SETTINGS_DIR  persisted tool settings (default: <repo>/settings)
    CONFEITO_MODELS_DIR    rembg model directory (default: <repo>/models)

Values from the .env file (GEMINI_API_KEY, ...) are copied into ``os.environ`` without
overriding variables that are already set. rembg reads its model directory from
``U2NET_HOME``; when neither the environment nor .env sets it, ``models_dir`` is used.
"""

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/src/app/config.py -> repository root
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CONFEITO_")

    env_file: Path = PROJECT_ROOT / ".env"
    archives_dir: Path = PROJECT_ROOT / "archives"
    settings_dir: Path = PROJECT_ROOT / "settings"
    models_dir: Path = PROJECT_ROOT / "models"

    @property
    def trash_dir(self) -> Path:
        return self.archives_dir / ".trash"

    @property
    def prompts_file(self) -> Path:
        return self.settings_dir / "default_prompts.json"


def read_env_file(path: Path) -> dict[str, str]:
    """Parses ``KEY=VALUE`` lines, ignoring blank lines and ``#`` comments."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def load_env_file(path: Path) -> None:
    """Copies .env values into os.environ (existing variables win)."""
    for key, value in read_env_file(path).items():
        if key == "U2NET_HOME" and not os.path.isabs(value):
            # an explicit rembg model directory is given relative to the .env file
            value = str((path.parent / value).resolve())
        os.environ.setdefault(key, value)


def default_model_home(models_dir: Path) -> None:
    """Points rembg (``U2NET_HOME``) at ``models_dir`` unless the environment or .env chose one."""
    os.environ.setdefault("U2NET_HOME", str(models_dir.resolve()))


settings = Settings()
load_env_file(settings.env_file)
default_model_home(settings.models_dir)
