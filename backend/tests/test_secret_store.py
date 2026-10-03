import os
from pathlib import Path

import pytest

from src.app import config
from src.app.services import secret_store


def test_saved_key_is_used_at_once_without_touching_the_environment(data_dir: Path) -> None:
    assert secret_store.get_gemini_key() is None
    secret_store.save_gemini_key(" first ")
    assert secret_store.get_gemini_key() == "first"
    secret_store.save_gemini_key("second")
    assert secret_store.get_gemini_key() == "second"
    assert "GEMINI_API_KEY" not in os.environ
    assert (data_dir / ".env").read_text(encoding="utf-8") == "GEMINI_API_KEY=second\n"


def test_env_file_wins_over_the_environment(data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "from-env")
    assert secret_store.get_gemini_key() == "from-env"
    (data_dir / ".env").write_text("GEMINI_API_KEY=from-file\n", encoding="utf-8")
    assert secret_store.get_gemini_key() == "from-file"


def test_empty_key_is_rejected_and_blank_counts_as_missing(data_dir: Path) -> None:
    with pytest.raises(secret_store.BadRequestError):
        secret_store.save_gemini_key("   ")
    (data_dir / ".env").write_text("GEMINI_API_KEY=  \n", encoding="utf-8")
    assert not secret_store.has_gemini_key()


def test_load_env_file_does_not_copy_the_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OTHER_VALUE", "")
    monkeypatch.delenv("OTHER_VALUE")
    env_file = tmp_path / ".env"
    env_file.write_text("GEMINI_API_KEY=secret\nOTHER_VALUE=1\n", encoding="utf-8")
    config.load_env_file(env_file)
    assert "GEMINI_API_KEY" not in os.environ
    assert os.environ["OTHER_VALUE"] == "1"
