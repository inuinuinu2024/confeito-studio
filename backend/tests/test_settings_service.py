"""Tool settings: initial values (default_prompts.json) + the user's values (user_settings.json)."""

import json
from pathlib import Path

import pytest

from src.app.services import settings_service as svc


@pytest.fixture
def settings_dir(data_dir: Path) -> Path:
    path = data_dir / "settings"
    path.mkdir()
    return path


def write(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def test_user_values_are_layered_over_the_initial_values(settings_dir: Path) -> None:
    write(settings_dir / "default_prompts.json", {"a_prompt": "初期", "a_size": "1K"})
    write(settings_dir / "user_settings.json", {"a_prompt": "ユーザー"})

    result = svc.load_tool_settings()

    assert result.values == {"a_prompt": "ユーザー", "a_size": "1K"}
    assert result.warnings == []


def test_update_merges_keys_and_never_writes_the_initial_values(settings_dir: Path) -> None:
    defaults = settings_dir / "default_prompts.json"
    write(defaults, {"a_prompt": "初期"})
    before = defaults.read_text(encoding="utf-8")
    write(settings_dir / "user_settings.json", {"b_model": "x"})

    assert svc.update_user_settings({"a_prompt": "ユーザー"}) == []

    # Other keys (another tool, another tab) are kept.
    saved = json.loads((settings_dir / "user_settings.json").read_text(encoding="utf-8"))
    assert saved == {"b_model": "x", "a_prompt": "ユーザー"}
    assert defaults.read_text(encoding="utf-8") == before
    assert not (settings_dir / "user_settings.json.tmp").exists()


def test_broken_user_file_is_moved_aside_with_a_warning(settings_dir: Path) -> None:
    write(settings_dir / "default_prompts.json", {"a_prompt": "初期"})
    (settings_dir / "user_settings.json").write_text("{broken", encoding="utf-8")

    result = svc.load_tool_settings()

    assert result.values == {"a_prompt": "初期"}
    backups = list(settings_dir.glob("user_settings.broken-*.json"))
    assert len(backups) == 1 and backups[0].read_text(encoding="utf-8") == "{broken"
    assert result.warnings == [
        f"ユーザー設定ファイル（user_settings.json）が壊れていたため {backups[0].name} に退避し、初期設定で読み込みました。"
    ]
    assert not (settings_dir / "user_settings.json").exists()


def test_update_does_not_overwrite_a_broken_user_file(settings_dir: Path) -> None:
    (settings_dir / "user_settings.json").write_text('["not", "a map"]', encoding="utf-8")

    warnings = svc.update_user_settings({"a_prompt": "x"})

    assert len(warnings) == 1 and "退避" in warnings[0]
    assert len(list(settings_dir.glob("user_settings.broken-*.json"))) == 1
    assert json.loads((settings_dir / "user_settings.json").read_text(encoding="utf-8")) == {"a_prompt": "x"}


def test_broken_initial_file_is_reported_but_left_alone(settings_dir: Path) -> None:
    (settings_dir / "default_prompts.json").write_text("not json", encoding="utf-8")
    write(settings_dir / "user_settings.json", {"a_prompt": "ユーザー"})

    result = svc.load_tool_settings()

    assert result.values == {"a_prompt": "ユーザー"}
    assert result.warnings == [
        "初期設定ファイル（default_prompts.json）を読み込めませんでした。アプリの既定値を使います。"
    ]
    assert (settings_dir / "default_prompts.json").read_text(encoding="utf-8") == "not json"


def test_missing_files_mean_no_settings(settings_dir: Path) -> None:
    assert svc.load_tool_settings() == svc.ToolSettingsResult()
