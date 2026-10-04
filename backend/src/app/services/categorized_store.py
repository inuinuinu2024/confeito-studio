"""An ordered list of named items in user-ordered categories, shared by the registered prompts
(prompt_service.py) and characters (character_service.py).

Every item is a dict with at least ``id``, ``name`` and ``category`` ("" = 未分類, never listed in
``categories`` and always last). ``categories`` is the order of the categories, ``items`` the order of
the items, which gives their order within a category. ``normalize`` groups the items by category and
keeps only the categories in use (new ones appended in order of appearance).
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, ClassVar

from ..errors import BadRequestError, ConflictError, NotFoundError

MAX_NAME_LENGTH = 100
MAX_CATEGORY_LENGTH = 50
UNCATEGORIZED_LABEL = "未分類"

Item = dict[str, Any]


def unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def new_id() -> str:
    return uuid.uuid4().hex


def stored_category(value: Any) -> str:
    """A category as stored: trimmed, and "" for 未分類 (also when the label itself is given)."""
    category = value.strip() if isinstance(value, str) else ""
    return "" if category == UNCATEGORIZED_LABEL else category


def validated_category(category: str) -> str:
    category = stored_category(category)
    if len(category) > MAX_CATEGORY_LENGTH:
        raise BadRequestError(f"カテゴリーは {MAX_CATEGORY_LENGTH} 文字以内にしてください。")
    return category


def stored_categories(value: Any) -> list[str]:
    """The ``categories`` of a file: names in order, without 未分類 and duplicates."""
    if not isinstance(value, list):
        return []
    return unique(c for c in (stored_category(c) for c in value if isinstance(c, str)) if c)


@dataclass
class CategorizedStore:
    """The normalized file: categories in order, items grouped by category in that order."""

    #: What an item is called in messages, e.g. "プロンプト".
    noun: ClassVar[str] = ""

    categories: list[str] = field(default_factory=list)
    items: list[Item] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def find(self, item_id: str) -> int:
        for i, item in enumerate(self.items):
            if item["id"] == item_id:
                return i
        raise NotFoundError(f"{self.noun}が見つかりません（削除された可能性があります）。")

    def names(self, except_id: str | None = None) -> set[str]:
        return {item["name"] for item in self.items if item["id"] != except_id}

    def index_of_name(self, name: str) -> int:
        return next(i for i, item in enumerate(self.items) if item["name"] == name)

    def normalize(self) -> None:
        """Groups the items by category (stable) and keeps only the categories in use, in order."""
        used = unique(item["category"] for item in self.items if item["category"])
        self.categories = [c for c in self.categories if c in used] + [c for c in used if c not in self.categories]
        rank = {c: i for i, c in enumerate(self.categories)}
        self.items.sort(key=lambda item: rank.get(item["category"], len(rank)))

    def validated_name(self, name: str) -> str:
        name = name.strip()
        if not name:
            raise BadRequestError(f"{self.noun}の名前を入力してください。")
        if len(name) > MAX_NAME_LENGTH:
            raise BadRequestError(f"{self.noun}の名前は {MAX_NAME_LENGTH} 文字以内にしてください。")
        return name

    def check_unique(self, name: str, own_id: str | None = None) -> None:
        if name in self.names(own_id):
            raise BadRequestError(f"同じ名前の{self.noun}「{name}」が登録されています。")

    def free_name(self, base: str, label: str = "") -> str:
        """``base + label``, else ``base + label + " (2)"``, `` (3)``…: the first name not taken.

        The base is cut so that the name stays within the length limit.
        """
        taken = self.names()
        n = 1
        while True:
            suffix = label if n == 1 else f"{label} ({n})"
            name = base[: MAX_NAME_LENGTH - len(suffix)] + suffix
            if name not in taken:
                return name
            n += 1

    def replace(self, i: int, item: Item) -> None:
        """Puts ``item`` at ``i``; an item whose category changed moves to the end (of its new category)."""
        if self.items[i]["category"] == item["category"]:
            self.items[i] = item
        else:
            del self.items[i]
            self.items.append(item)

    def _changed_meanwhile(self) -> ConflictError:
        return ConflictError(f"{self.noun}の一覧が変わっています。読み直してから並べ替えてください。")

    def reorder_items(self, category: str, ids: list[str]) -> None:
        """Puts the items of ``category`` in the order of ``ids`` (which must be exactly that category's items)."""
        category = stored_category(category)
        slots = [i for i, item in enumerate(self.items) if item["category"] == category]
        by_id = {self.items[i]["id"]: self.items[i] for i in slots}
        if len(ids) != len(slots) or set(ids) != set(by_id):
            raise self._changed_meanwhile()
        for slot, item_id in zip(slots, ids, strict=True):
            self.items[slot] = by_id[item_id]

    def reorder_categories(self, categories: list[str]) -> None:
        """Sets the order of the categories (which must be exactly the categories in use)."""
        wanted = [stored_category(c) for c in categories]
        if len(wanted) != len(self.categories) or set(wanted) != set(self.categories):
            raise self._changed_meanwhile()
        self.categories = wanted

    def rename_category(self, old: str, new: str) -> bool:
        """Renames a category in place; into an existing category (or 未分類) its items move to that one's end.

        Returns False when nothing changed (the same name).
        """
        old = stored_category(old)
        new = validated_category(new)
        if not old or old not in self.categories:
            raise NotFoundError(
                f"カテゴリー「{old or UNCATEGORIZED_LABEL}」が見つかりません（変更された可能性があります）。"
            )
        if new == old:
            return False
        if new and new not in self.categories:
            self.categories = [new if c == old else c for c in self.categories]
            for item in self.items:
                if item["category"] == old:
                    item["category"] = new
        else:
            moved = [{**item, "category": new} for item in self.items if item["category"] == old]
            self.items = [item for item in self.items if item["category"] != old] + moved
        return True

    def add_categories(self, categories: Any) -> None:
        """Appends the categories of an imported file that are not known yet (in the file's order)."""
        self.categories = unique(self.categories + stored_categories(categories))
