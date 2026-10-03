"""Gemini API key (.env) and persisted tool settings (settings/default_prompts.json).

``default_prompts.json`` is a flat ``{key: string}`` map shared by every frontend tool;
keys are namespaced per tool (e.g. ``nanoBananaPro_prompt``, ``panelSplitter_model``).
"""

import json
import os
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


def get_default_prompts() -> dict[str, Any]:
    try:
        return json.loads(settings.prompts_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_default_prompts(prompts: dict[str, Any]) -> None:
    try:
        settings.settings_dir.mkdir(parents=True, exist_ok=True)
        settings.prompts_file.write_text(json.dumps(prompts, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as e:
        raise SettingsServiceError("ツールの設定を保存できませんでした。", raw_response=exception_text(e)) from e
