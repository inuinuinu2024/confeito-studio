"""Prompts the user registers, shared by every tool (docs/specs/prompt-manager.md).

Kept in ``assets/prompts/prompts.json`` (not in git)::

    {"categories": ["着彩", "背景"],
     "prompts": [{"id": "<hex>", "name": "着彩（線画維持）", "category": "着彩", "text": "..."}, ...]}

``categories`` is the order of the categories ("" = 未分類 is never listed and always comes last);
``prompts`` is the order of the prompts, which gives their order within a category. The file can be
edited outside the app, so every call reads it again and normalizes it (``_load``): categories missing
from ``categories`` are appended in order of appearance, unused ones dropped, and the prompts grouped
by category. Entries that are not ``{id, name, text}`` strings are skipped (and dropped on the next
write). Every change is written at once, atomically; a broken file is moved aside (json_file.py).
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Literal

from ..config import settings
from ..errors import BadRequestError, ConflictError, NotFoundError
from .json_file import read_or_move_aside, write_json_atomic

MAX_NAME_LENGTH = 100
MAX_CATEGORY_LENGTH = 50
UNCATEGORIZED_LABEL = "未分類"

Prompt = dict[str, str]
OnConflict = Literal["overwrite", "rename", "skip"]


@dataclass
class Store:
    """The normalized file: categories in order, prompts grouped by category in that order."""

    categories: list[str] = field(default_factory=list)
    prompts: list[Prompt] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def find(self, prompt_id: str) -> int:
        for i, prompt in enumerate(self.prompts):
            if prompt["id"] == prompt_id:
                return i
        raise NotFoundError("プロンプトが見つかりません（削除された可能性があります）。")

    def names(self, except_id: str | None = None) -> set[str]:
        return {p["name"] for p in self.prompts if p["id"] != except_id}

    def normalize(self) -> None:
        """Groups the prompts by category (stable) and keeps only the categories in use, in order."""
        used = _unique(p["category"] for p in self.prompts if p["category"])
        self.categories = [c for c in self.categories if c in used] + [c for c in used if c not in self.categories]
        rank = {c: i for i, c in enumerate(self.categories)}
        self.prompts.sort(key=lambda p: rank.get(p["category"], len(rank)))


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


def _unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def _category(value: Any) -> str:
    """A category as stored: trimmed, and "" for 未分類 (also when the label itself is given)."""
    category = value.strip() if isinstance(value, str) else ""
    return "" if category == UNCATEGORIZED_LABEL else category


def _load() -> Store:
    store = Store()
    data = read_or_move_aside(
        settings.prompts_file, "プロンプトファイル", "登録プロンプトなしで読み込みました", store.warnings
    )
    categories = data.get("categories")
    if isinstance(categories, list):
        store.categories = _unique(c for c in (_category(c) for c in categories if isinstance(c, str)) if c)
    items = data.get("prompts")
    if isinstance(items, list):
        store.prompts = [
            {"id": item["id"], "name": item["name"], "category": _category(item.get("category")), "text": item["text"]}
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


def _validated_name(name: str) -> str:
    name = name.strip()
    if not name:
        raise BadRequestError("プロンプトの名前を入力してください。")
    if len(name) > MAX_NAME_LENGTH:
        raise BadRequestError(f"プロンプトの名前は {MAX_NAME_LENGTH} 文字以内にしてください。")
    return name


def _validated_category(category: str) -> str:
    category = _category(category)
    if len(category) > MAX_CATEGORY_LENGTH:
        raise BadRequestError(f"カテゴリーは {MAX_CATEGORY_LENGTH} 文字以内にしてください。")
    return category


def _validated_text(text: str) -> str:
    if not text.strip():
        raise BadRequestError("プロンプトの本文を入力してください。")
    return text


def _check_unique(store: Store, name: str, own_id: str | None = None) -> None:
    if name in store.names(own_id):
        raise BadRequestError(f"同じ名前のプロンプト「{name}」が登録されています。")


def _free_name(taken: set[str], base: str, label: str = "") -> str:
    """``base + label``, else ``base + label + " (2)"``, `` (3)``…: the first name not in ``taken``.

    The base is cut so that the name stays within the length limit.
    """
    n = 1
    while True:
        suffix = label if n == 1 else f"{label} ({n})"
        name = base[: MAX_NAME_LENGTH - len(suffix)] + suffix
        if name not in taken:
            return name
        n += 1


def _replace(store: Store, i: int, prompt: Prompt) -> None:
    """Puts ``prompt`` at ``i``; a prompt whose category changed moves to the end (of its new category)."""
    if store.prompts[i]["category"] == prompt["category"]:
        store.prompts[i] = prompt
    else:
        del store.prompts[i]
        store.prompts.append(prompt)


def list_prompts() -> Store:
    return _load()


def create_prompt(name: str, category: str, text: str) -> PromptResult:
    """Registers a new prompt at the end of its category."""
    prompt = {
        "id": uuid.uuid4().hex,
        "name": _validated_name(name),
        "category": _validated_category(category),
        "text": _validated_text(text),
    }
    store = _load()
    _check_unique(store, prompt["name"])
    store.prompts.append(prompt)
    _save(store)
    return PromptResult(prompt, store.warnings)


def update_prompt(prompt_id: str, name: str, category: str, text: str) -> PromptResult:
    """Replaces the name, category and text (its place is kept unless the category changes)."""
    prompt = {
        "id": prompt_id,
        "name": _validated_name(name),
        "category": _validated_category(category),
        "text": _validated_text(text),
    }
    store = _load()
    i = store.find(prompt_id)
    _check_unique(store, prompt["name"], prompt_id)
    _replace(store, i, prompt)
    _save(store)
    return PromptResult(prompt, store.warnings)


def move_prompt(prompt_id: str, category: str) -> PromptResult:
    """Moves a prompt to the end of ``category`` (name and text unchanged)."""
    category = _validated_category(category)
    store = _load()
    i = store.find(prompt_id)
    prompt = {**store.prompts[i], "category": category}
    _replace(store, i, prompt)
    _save(store)
    return PromptResult(prompt, store.warnings)


def delete_prompt(prompt_id: str) -> list[str]:
    store = _load()
    del store.prompts[store.find(prompt_id)]
    _save(store)
    return store.warnings


def duplicate_prompt(prompt_id: str) -> PromptResult:
    """Copies a prompt as "<name> のコピー" (or " (2)"…) right after it."""
    store = _load()
    i = store.find(prompt_id)
    source = store.prompts[i]
    copy = {**source, "id": uuid.uuid4().hex, "name": _free_name(store.names(), source["name"], " のコピー")}
    store.prompts.insert(i + 1, copy)
    _save(store)
    return PromptResult(copy, store.warnings)


def reorder_prompts(category: str, ids: list[str]) -> list[str]:
    """Puts the prompts of ``category`` in the order of ``ids`` (which must be exactly that category's prompts)."""
    category = _category(category)
    store = _load()
    slots = [i for i, p in enumerate(store.prompts) if p["category"] == category]
    by_id = {store.prompts[i]["id"]: store.prompts[i] for i in slots}
    if len(ids) != len(slots) or set(ids) != set(by_id):
        raise ConflictError("プロンプトの一覧が変わっています。読み直してから並べ替えてください。")
    for slot, prompt_id in zip(slots, ids, strict=True):
        store.prompts[slot] = by_id[prompt_id]
    _save(store)
    return store.warnings


def reorder_categories(categories: list[str]) -> list[str]:
    """Sets the order of the categories (which must be exactly the categories in use)."""
    store = _load()
    wanted = [_category(c) for c in categories]
    if len(wanted) != len(store.categories) or set(wanted) != set(store.categories):
        raise ConflictError("プロンプトの一覧が変わっています。読み直してから並べ替えてください。")
    store.categories = wanted
    _save(store)
    return store.warnings


def rename_category(old: str, new: str) -> list[str]:
    """Renames a category in place; into an existing category (or 未分類) its prompts move to that one's end."""
    old = _category(old)
    new = _validated_category(new)
    store = _load()
    if not old or old not in store.categories:
        raise NotFoundError(
            f"カテゴリー「{old or UNCATEGORIZED_LABEL}」が見つかりません（変更された可能性があります）。"
        )
    if new == old:
        return store.warnings
    if new and new not in store.categories:
        store.categories = [new if c == old else c for c in store.categories]
        for prompt in store.prompts:
            if prompt["category"] == old:
                prompt["category"] = new
    else:
        moved = [{**p, "category": new} for p in store.prompts if p["category"] == old]
        store.prompts = [p for p in store.prompts if p["category"] != old] + moved
    _save(store)
    return store.warnings


def _import_entry(item: Any) -> tuple[str, str, str] | None:
    """The validated (name, category, text) of an imported item, or None when it cannot be registered."""
    if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not isinstance(item.get("text"), str):
        return None
    category = item.get("category")
    try:
        return (
            _validated_name(item["name"]),
            _validated_category(category if isinstance(category, str) else ""),
            _validated_text(item["text"]),
        )
    except BadRequestError:
        return None


def import_prompts(items: list[Any], categories: list[Any], on_conflict: OnConflict) -> ImportResult:
    """Adds the prompts of an exported file; names already taken are overwritten, renamed or skipped."""
    store = _load()
    result = ImportResult(warnings=store.warnings)
    # New categories are appended in the file's order (then in order of appearance).
    store.categories += [c for c in (_category(c) for c in categories if isinstance(c, str)) if c]
    store.categories = _unique(store.categories)
    for item in items:
        entry = _import_entry(item)
        if entry is None:
            result.invalid += 1
            continue
        name, category, text = entry
        if name not in store.names():
            store.prompts.append({"id": uuid.uuid4().hex, "name": name, "category": category, "text": text})
            result.added += 1
        elif on_conflict == "overwrite":
            i = next(i for i, p in enumerate(store.prompts) if p["name"] == name)
            _replace(store, i, {**store.prompts[i], "category": category, "text": text})
            result.overwritten += 1
        elif on_conflict == "rename":
            renamed = _free_name(store.names(), name)
            store.prompts.append({"id": uuid.uuid4().hex, "name": renamed, "category": category, "text": text})
            result.added += 1
        else:
            result.skipped += 1
    if result.added or result.overwritten:
        _save(store)
    return result
