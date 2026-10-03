"""Gemini API key (.env) and the tool settings (docs/specs/app-shell.md 「設定の保存」).

Tool settings are a flat ``{key: string}`` map shared by every frontend tool; keys are namespaced
per tool (e.g. ``nanoBananaPro_prompt``, ``panelSplitter_model``). Two files:

* ``default_prompts.json`` — initial values shipped with the app (in git). Only read.
* ``user_settings.json`` — the user's values (not in git), layered over the initial ones.
  Updates merge the given keys and replace the file atomically (temp file + rename), so a
  failed write never leaves a half-written file and other keys (another tab, another tool) survive.

A file that cannot be parsed is never overwritten: the user file is moved aside to
``user_settings.broken-<stamp>.json`` and a Japanese warning is returned for the frontend to show.
"""

import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from ..config import settings
from ..errors import AppError, exception_text


class SettingsServiceError(AppError):
    pass


def get_gemini_key_status() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def save_gemini_key(api_key: str) -> None:
    """Sets GEMINI_API_KEY in os.environ and in the .env file (other lines are preserved)."""
    new_key = api_key.strip()
    os.environ["GEMINI_API_KEY"] = new_key
    env_file = settings.env_file
    try:
        lines = env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []
        key_line = f"GEMINI_API_KEY={new_key}"
        replaced = False
        for i, line in enumerate(lines):
            if line.strip().startswith("GEMINI_API_KEY="):
                lines[i] = key_line
                replaced = True
        if not replaced:
            lines.append(key_line)
        env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except OSError as e:
        raise SettingsServiceError("API Key を .env に保存できませんでした。", raw_response=exception_text(e)) from e


@dataclass
class ToolSettingsResult:
    values: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def _read_map(path: Path) -> dict[str, Any] | None:
    """The JSON object in ``path``: {} when the file is missing, None when it cannot be parsed."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _backup_path(path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    candidate = path.with_name(f"{path.stem}.broken-{stamp}{path.suffix}")
    n = 2
    while candidate.exists():
        candidate = path.with_name(f"{path.stem}.broken-{stamp}_{n}{path.suffix}")
        n += 1
    return candidate


def _read_user_settings(warnings: list[str]) -> dict[str, Any]:
    """The user's values; a broken file is moved aside (with a warning) and counts as empty."""
    path = settings.user_settings_file
    values = _read_map(path)
    if values is not None:
        return values
    backup = _backup_path(path)
    try:
        path.replace(backup)
    except OSError as e:
        raise SettingsServiceError(
            f"ユーザー設定ファイル（{path.name}）が壊れていて、退避もできませんでした。ファイルを確認してください。",
            raw_response=exception_text(e),
        ) from e
    warnings.append(
        f"ユーザー設定ファイル（{path.name}）が壊れていたため {backup.name} に退避し、初期設定で読み込みました。"
    )
    return {}


def load_tool_settings() -> ToolSettingsResult:
    """The initial values with the user's values layered on top."""
    result = ToolSettingsResult()
    defaults = _read_map(settings.default_settings_file)
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
    path = settings.user_settings_file
    tmp = path.with_name(f"{path.name}.tmp")
    try:
        settings.settings_dir.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(path)
    except OSError as e:
        tmp.unlink(missing_ok=True)
        raise SettingsServiceError("ツールの設定を保存できませんでした。", raw_response=exception_text(e)) from e
    return warnings
