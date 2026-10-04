"""Prompts the user registers, shared by every tool (docs/specs/prompt-manager.md).

Kept in ``assets/prompts/prompts.json`` (not in git)::

    {"categories": ["着彩", "背景"],
     "prompts": [{"id": "<hex>", "name": "着彩（線画維持）", "category": "着彩", "text": "..."}, ...]}

``categories`` is the order of the categories ("" = 未分類 is never listed and always comes last);
``prompts`` is the order of the prompts, which gives their order within a category (categorized_store.py).
The file can be edited outside the app, so every call reads it again and normalizes it (``_load``).
Entries that are not ``{id, name, text}`` strings are skipped (and dropped on the next write).
Every change is written at once, atomically; a broken file is moved aside (json_file.py).
"""

from dataclasses import dataclass, field
from typing import Any, Literal

from ..config import settings
from ..errors import BadRequestError
from .categorized_store import (
    CategorizedStore,
    new_id,
    stored_categories,
    stored_category,
    validated_category,
)
from .json_file import read_or_move_aside, write_json_atomic

Prompt = dict[str, str]
OnConflict = Literal["overwrite", "rename", "skip"]


@dataclass
class Store(CategorizedStore):
    noun = "プロンプト"

    @property
    def prompts(self) -> list[Prompt]:
        return self.items


@dataclass
class PromptResult:
    prompt: Prompt
    warnings: list[str] = field(default_factory=list)


@dataclass
class ImportResult:
    added: int = 0
    overwritten: int = 0
    skipped: int = 0
    invalid: int = 0
    warnings: list[str] = field(default_factory=list)


def _load() -> Store:
    store = Store()
    data = read_or_move_aside(
        settings.prompts_file, "プロンプトファイル", "登録プロンプトなしで読み込みました", store.warnings
    )
    store.categories = stored_categories(data.get("categories"))
    items = data.get("prompts")
    if isinstance(items, list):
        store.items = [
            {
                "id": item["id"],
                "name": item["name"],
                "category": stored_category(item.get("category")),
                "text": item["text"],
            }
            for item in items
            if isinstance(item, dict) and all(isinstance(item.get(k), str) for k in ("id", "name", "text"))
        ]
    store.normalize()
    return store


def _save(store: Store) -> None:
    store.normalize()
    write_json_atomic(
        settings.prompts_file,
        {"categories": store.categories, "prompts": store.prompts},
        "プロンプトを保存できませんでした。",
    )


def _validated_text(text: str) -> str:
    if not text.strip():
        raise BadRequestError("プロンプトの本文を入力してください。")
    return text


def _prompt(store: Store, prompt_id: str, name: str, category: str, text: str) -> Prompt:
    return {
        "id": prompt_id,
        "name": store.validated_name(name),
        "category": validated_category(category),
        "text": _validated_text(text),
    }


def list_prompts() -> Store:
    return _load()


def create_prompt(name: str, category: str, text: str) -> PromptResult:
    """Registers a new prompt at the end of its category."""
    prompt = _prompt(Store(), new_id(), name, category, text)
    store = _load()
    store.check_unique(prompt["name"])
    store.items.append(prompt)
    _save(store)
    return PromptResult(prompt, store.warnings)


def update_prompt(prompt_id: str, name: str, category: str, text: str) -> PromptResult:
    """Replaces the name, category and text (its place is kept unless the category changes)."""
    prompt = _prompt(Store(), prompt_id, name, category, text)
    store = _load()
    i = store.find(prompt_id)
    store.check_unique(prompt["name"], prompt_id)
    store.replace(i, prompt)
    _save(store)
    return PromptResult(prompt, store.warnings)


def move_prompt(prompt_id: str, category: str) -> PromptResult:
    """Moves a prompt to the end of ``category`` (name and text unchanged)."""
    category = validated_category(category)
    store = _load()
    i = store.find(prompt_id)
    prompt = {**store.items[i], "category": category}
    store.replace(i, prompt)
    _save(store)
    return PromptResult(prompt, store.warnings)


def delete_prompt(prompt_id: str) -> list[str]:
    store = _load()
    del store.items[store.find(prompt_id)]
    _save(store)
    return store.warnings


def duplicate_prompt(prompt_id: str) -> PromptResult:
    """Copies a prompt as "<name> のコピー" (or " (2)"…) right after it."""
    store = _load()
    i = store.find(prompt_id)
    source = store.items[i]
    copy = {**source, "id": new_id(), "name": store.free_name(source["name"], " のコピー")}
    store.items.insert(i + 1, copy)
    _save(store)
    return PromptResult(copy, store.warnings)


def reorder_prompts(category: str, ids: list[str]) -> list[str]:
    """Puts the prompts of ``category`` in the order of ``ids`` (which must be exactly that category's prompts)."""
    store = _load()
    store.reorder_items(category, ids)
    _save(store)
    return store.warnings


def reorder_categories(categories: list[str]) -> list[str]:
    """Sets the order of the categories (which must be exactly the categories in use)."""
    store = _load()
    store.reorder_categories(categories)
    _save(store)
    return store.warnings


def rename_category(old: str, new: str) -> list[str]:
    """Renames a category in place; into an existing category (or 未分類) its prompts move to that one's end."""
    store = _load()
    if store.rename_category(old, new):
        _save(store)
    return store.warnings


def _import_entry(store: Store, item: Any) -> tuple[str, str, str] | None:
    """The validated (name, category, text) of an imported item, or None when it cannot be registered."""
    if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not isinstance(item.get("text"), str):
        return None
    category = item.get("category")
    try:
        return (
            store.validated_name(item["name"]),
            validated_category(category if isinstance(category, str) else ""),
            _validated_text(item["text"]),
        )
    except BadRequestError:
        return None


def import_prompts(items: list[Any], categories: list[Any], on_conflict: OnConflict) -> ImportResult:
    """Adds the prompts of an exported file; names already taken are overwritten, renamed or skipped."""
    store = _load()
    result = ImportResult(warnings=store.warnings)
    store.add_categories(categories)
    for item in items:
        entry = _import_entry(store, item)
        if entry is None:
            result.invalid += 1
            continue
        name, category, text = entry
        if name not in store.names():
            store.items.append({"id": new_id(), "name": name, "category": category, "text": text})
            result.added += 1
        elif on_conflict == "overwrite":
            i = store.index_of_name(name)
            store.replace(i, {**store.items[i], "category": category, "text": text})
            result.overwritten += 1
        elif on_conflict == "rename":
            store.items.append({"id": new_id(), "name": store.free_name(name), "category": category, "text": text})
            result.added += 1
        else:
            result.skipped += 1
    if result.added or result.overwritten:
        _save(store)
    return result
