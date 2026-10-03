"""The tool settings (docs/specs/app-shell.md 「設定の保存」). The Gemini API key is in secret_store.py.

Tool settings are the tools' parameters and screen state (registered prompts are kept apart, in
prompt_service.py) as a flat ``{key: string}`` map shared by every frontend tool; keys are namespaced
per tool (e.g. ``nanoBananaPro_prompt``, ``panelSplitter_model``). Two files:

* ``default_settings.json`` — initial values shipped with the app (in git). Only read.
* ``user_settings.json`` — the user's values (not in git), layered over the initial ones.
  Updates merge the given keys and replace the file atomically (temp file + rename), so a
  failed write never leaves a half-written file and other keys (another tab, another tool) survive.

A user file that cannot be parsed is never overwritten: it is moved aside to
``user_settings.broken-<stamp>.json`` and a Japanese warning is returned for the frontend to show (json_file.py).
"""

from dataclasses import dataclass, field
from typing import Any

from ..config import settings
from ..errors import AppError
from .json_file import read_json_object, read_or_move_aside, write_json_atomic


class SettingsServiceError(AppError):
    pass


@dataclass
class ToolSettingsResult:
    values: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _read_user_settings(warnings: list[str]) -> dict[str, Any]:
    """The user's values; a broken file is moved aside (with a warning) and counts as empty."""
    return read_or_move_aside(settings.user_settings_file, "ユーザー設定ファイル", "初期設定で読み込みました", warnings)


def load_tool_settings() -> ToolSettingsResult:
    """The initial values with the user's values layered on top."""
    result = ToolSettingsResult()
    defaults = read_json_object(settings.default_settings_file)
    if defaults is None:
        defaults = {}
        result.warnings.append(
            f"初期設定ファイル（{settings.default_settings_file.name}）を読み込めませんでした。アプリの既定値を使います。"
        )
    result.values = {**defaults, **_read_user_settings(result.warnings)}
    return result


def update_user_settings(values: dict[str, Any]) -> list[str]:
    """Merges ``values`` into the user's settings and saves them atomically; returns warnings."""
    warnings: list[str] = []
    merged = {**_read_user_settings(warnings), **values}
    write_json_atomic(settings.user_settings_file, merged, "ツールの設定を保存できませんでした。")
    return warnings
