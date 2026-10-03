"""Shared fixtures. Every test runs against temporary data directories.

The real .env (API key) and archives/ are never touched: CONFEITO_ENV_FILE is
redirected before the app is imported and paths are patched per test.
"""

import io
import os
import tempfile
from pathlib import Path

import pytest
from PIL import Image

os.environ["CONFEITO_ENV_FILE"] = str(Path(tempfile.gettempdir()) / "confeito-tests-missing.env")
os.environ.pop("GEMINI_API_KEY", None)

from src.app.config import settings  # noqa: E402


@pytest.fixture(autouse=True)
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(settings, "archives_dir", tmp_path / "archives")
    monkeypatch.setattr(settings, "settings_dir", tmp_path / "settings")
    monkeypatch.setattr(settings, "assets_dir", tmp_path / "assets")
    monkeypatch.setattr(settings, "env_file", tmp_path / ".env")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    (tmp_path / "archives").mkdir()
    return tmp_path


@pytest.fixture
def archives_dir(data_dir: Path) -> Path:
    return data_dir / "archives"


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from src.app.main import app

    return TestClient(app, raise_server_exceptions=False)


def make_png(width: int, height: int, color: tuple[int, int, int, int] = (255, 0, 0, 255)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (width, height), color).save(buf, format="PNG")
    return buf.getvalue()
