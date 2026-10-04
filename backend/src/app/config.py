"""Application configuration.

Every filesystem location used by the backend is defined here; services must not
derive paths from ``__file__``. Each value can be overridden with a ``CONFEITO_*``
environment variable (the tests and the E2E harness point them at temp dirs):

    CONFEITO_ENV_FILE      .env loaded into os.environ at startup (default: <repo>/.env)
    CONFEITO_ARCHIVES_DIR  the default archive storage (default: <repo>/archives). The user can set another
                           folder in the settings window (保存先; services/archives_location.py), which wins
    CONFEITO_SETTINGS_DIR  tool settings: default_settings.json (initial values, in git) and
                           user_settings.json (the user's values, not in git) (default: <repo>/settings)
    CONFEITO_ASSETS_DIR    the user's assets, not in git: prompts/prompts.json (registered prompts) and
                           characters/ (registered characters and their images) (default: <repo>/assets)
    CONFEITO_DATA_DIR      records the app keeps by itself, not in git: usage.db (Gemini usage of the
                           Cost Monitor, SQLite) (default: <repo>/data)
    CONFEITO_MODELS_DIR    rembg model and the anime face detector (downloaded on first use) (default: <repo>/models)
    CONFEITO_PROJECT_DIR   where 画像読み込み's file dialog opens when no folder is set (default: <repo>)

Values from the .env file are copied into ``os.environ`` without overriding variables that are
already set, except ``GEMINI_API_KEY`` (read from the file by services/secret_store.py). rembg reads its model directory from
``U2NET_HOME``; when neither the environment nor .env sets it, ``models_dir`` is used.
"""

import os
from pathlib import Path

from pydantic import Field, PrivateAttr
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/src/app/config.py -> repository root
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CONFEITO_")

    env_file: Path = PROJECT_ROOT / ".env"
    default_archives_dir: Path = Field(PROJECT_ROOT / "archives", validation_alias="CONFEITO_ARCHIVES_DIR")
    settings_dir: Path = PROJECT_ROOT / "settings"
    assets_dir: Path = PROJECT_ROOT / "assets"
    data_dir: Path = PROJECT_ROOT / "data"
    models_dir: Path = PROJECT_ROOT / "models"
    project_dir: Path = PROJECT_ROOT
    _archives_override: Path | None = PrivateAttr(default=None)

    @property
    def archives_dir(self) -> Path:
        """The ARCHIVES folder in use: the one the user set (保存先), else ``default_archives_dir``."""
        return self._archives_override or self.default_archives_dir

    def use_archives_dir(self, folder: Path | None) -> None:
        """Switches the ARCHIVES folder (None = back to the default). Only services/archives_location.py calls it."""
        self._archives_override = folder

    @property
    def trash_dir(self) -> Path:
        return self.archives_dir / ".trash"

    @property
    def default_settings_file(self) -> Path:
        """Initial tool settings shipped with the app (in git, never written by the app)."""
        return self.settings_dir / "default_settings.json"

    @property
    def user_settings_file(self) -> Path:
        """The user's tool settings (not in git), layered over the initial ones."""
        return self.settings_dir / "user_settings.json"

    @property
    def prompts_file(self) -> Path:
        """The prompts the user registered, shared by every tool (not in git)."""
        return self.assets_dir / "prompts" / "prompts.json"

    @property
    def characters_dir(self) -> Path:
        """The characters the user registered: characters.json and one image folder per character (not in git)."""
        return self.assets_dir / "characters"

    @property
    def characters_file(self) -> Path:
        return self.characters_dir / "characters.json"

    @property
    def usage_db_file(self) -> Path:
        """Gemini calls made from this app and their costs, SQLite (Cost Monitor, services/usage_store.py, not in git)."""
        return self.data_dir / "usage.db"

    @property
    def face_model_file(self) -> Path:
        """Anime face detector for character icons (services/face_service.py), downloaded on first use."""
        return self.models_dir / "anime_face_detect_v1.4_s.onnx"


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


# Read from the .env file by services/secret_store.py itself, never copied into os.environ.
SECRET_ENV_NAMES = {"GEMINI_API_KEY"}


def load_env_file(path: Path) -> None:
    """Copies .env values into os.environ (existing variables win), except the secrets."""
    for key, value in read_env_file(path).items():
        if key in SECRET_ENV_NAMES:
            continue
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
