import os
from pathlib import Path

import pytest

from src.app import config


@pytest.fixture(autouse=True)
def no_model_home(monkeypatch: pytest.MonkeyPatch) -> None:
    # setenv first so that monkeypatch restores the original U2NET_HOME after the test
    monkeypatch.setenv("U2NET_HOME", "")
    monkeypatch.delenv("U2NET_HOME")


def test_models_dir_is_the_default_rembg_home(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("# no U2NET_HOME\n", encoding="utf-8")

    config.load_env_file(env_file)
    config.default_model_home(tmp_path / "models")

    assert os.environ["U2NET_HOME"] == str((tmp_path / "models").resolve())


def test_u2net_home_in_env_file_still_wins(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("U2NET_HOME=other\n", encoding="utf-8")

    config.load_env_file(env_file)
    config.default_model_home(tmp_path / "models")

    assert os.environ["U2NET_HOME"] == str((tmp_path / "other").resolve())


def test_default_models_dir_is_in_the_repository() -> None:
    assert config.Settings().models_dir == config.PROJECT_ROOT / "models"
