"""Prompts the user registers, per tool (docs/specs/tools/gemini-image.md 「プロンプト」).

Kept apart from the tool settings in ``settings/prompts.json`` (not in git)::

    {"nanoBananaPro": [{"id": "<hex>", "name": "表情差分", "text": "..."}, ...]}

Keys are the tools' settings prefixes; each list is in registration order (new prompts at the end).
Every change is written at once, atomically; a broken file is moved aside (json_file.py).
Entries that are not ``{id, name, text}`` strings are skipped (and dropped when that tool's list is written).
"""

import re
import uuid
from dataclasses import dataclass, field
from typing import Any

from ..config import settings
from ..errors import BadRequestError, NotFoundError
from .json_file import read_or_move_aside, write_json_atomic

MAX_NAME_LENGTH = 100
_TOOL_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9]*$")


@dataclass
class PromptsResult:
    prompts: list[dict[str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class PromptResult:
    prompt: dict[str, str]
    warnings: list[str] = field(default_factory=list)


def _check_tool(tool: str) -> None:
    if not _TOOL_PATTERN.match(tool):
        raise BadRequestError(f"ツール名が正しくありません: {tool}")


def _read_all(warnings: list[str]) -> dict[str, Any]:
    return read_or_move_aside(
        settings.prompts_file, "プロンプトファイル", "登録プロンプトなしで読み込みました", warnings
    )


def _entries(data: dict[str, Any], tool: str) -> list[dict[str, str]]:
    items = data.get(tool)
    if not isinstance(items, list):
        return []
    return [
        {"id": item["id"], "name": item["name"], "text": item["text"]}
        for item in items
        if isinstance(item, dict) and all(isinstance(item.get(k), str) for k in ("id", "name", "text"))
    ]


def _write(data: dict[str, Any], tool: str, entries: list[dict[str, str]]) -> None:
    write_json_atomic(settings.prompts_file, {**data, tool: entries}, "プロンプトを保存できませんでした。")


def _validated(name: str, text: str) -> tuple[str, str]:
    name = name.strip()
    if not name:
        raise BadRequestError("プロンプトの名前を入力してください。")
    if len(name) > MAX_NAME_LENGTH:
        raise BadRequestError(f"プロンプトの名前は {MAX_NAME_LENGTH} 文字以内にしてください。")
    if not text.strip():
        raise BadRequestError("プロンプトの本文を入力してください。")
    return name, text


def _check_unique(entries: list[dict[str, str]], name: str, own_id: str | None = None) -> None:
    if any(e["name"] == name and e["id"] != own_id for e in entries):
        raise BadRequestError(f"同じ名前のプロンプト「{name}」が登録されています。")


def _index(entries: list[dict[str, str]], prompt_id: str) -> int:
    for i, entry in enumerate(entries):
        if entry["id"] == prompt_id:
            return i
    raise NotFoundError("プロンプトが見つかりません（削除された可能性があります）。")


def list_prompts(tool: str) -> PromptsResult:
    _check_tool(tool)
    result = PromptsResult()
    result.prompts = _entries(_read_all(result.warnings), tool)
    return result


def create_prompt(tool: str, name: str, text: str) -> PromptResult:
    """Registers a new prompt at the end of the tool's list."""
    _check_tool(tool)
    name, text = _validated(name, text)
    warnings: list[str] = []
    data = _read_all(warnings)
    entries = _entries(data, tool)
    _check_unique(entries, name)
    prompt = {"id": uuid.uuid4().hex, "name": name, "text": text}
    _write(data, tool, [*entries, prompt])
    return PromptResult(prompt, warnings)


def update_prompt(tool: str, prompt_id: str, name: str, text: str) -> PromptResult:
    """Replaces the name and text of a registered prompt (its place in the list is kept)."""
    _check_tool(tool)
    name, text = _validated(name, text)
    warnings: list[str] = []
    data = _read_all(warnings)
    entries = _entries(data, tool)
    i = _index(entries, prompt_id)
    _check_unique(entries, name, prompt_id)
    entries[i] = {"id": prompt_id, "name": name, "text": text}
    _write(data, tool, entries)
    return PromptResult(entries[i], warnings)


def delete_prompt(tool: str, prompt_id: str) -> list[str]:
    _check_tool(tool)
    warnings: list[str] = []
    data = _read_all(warnings)
    entries = _entries(data, tool)
    del entries[_index(entries, prompt_id)]
    _write(data, tool, entries)
    return warnings
