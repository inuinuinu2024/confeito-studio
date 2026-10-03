"""Registered prompts shared by every tool (assets/prompts/prompts.json)."""

import json
from pathlib import Path

import pytest

from src.app.errors import BadRequestError, ConflictError, NotFoundError
from src.app.services import prompt_service as svc


@pytest.fixture
def prompts_file(data_dir: Path) -> Path:
    return data_dir / "assets" / "prompts" / "prompts.json"


def read(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def names() -> list[str]:
    return [p["name"] for p in svc.list_prompts().prompts]


def create(name: str, category: str = "", text: str = "text") -> dict[str, str]:
    return svc.create_prompt(name, category, text).prompt


def test_create_appends_to_its_category_and_writes_atomically(prompts_file: Path) -> None:
    a = create("a", "着彩")
    b = create("b", "背景")
    c = create("c", "着彩")
    d = create("d")

    assert a["id"] != b["id"]
    store = svc.list_prompts()
    assert store.categories == ["着彩", "背景"]
    assert store.prompts == [a, c, b, d]
    assert read(prompts_file) == {"categories": ["着彩", "背景"], "prompts": [a, c, b, d]}
    assert not prompts_file.with_name("prompts.json.tmp").exists()


def test_names_are_unique_across_categories() -> None:
    a = create("a", "着彩")
    create("b", "背景")

    with pytest.raises(BadRequestError, match="同じ名前"):
        create(" a ", "背景")
    with pytest.raises(BadRequestError, match="同じ名前"):
        svc.update_prompt(a["id"], "b", "着彩", "x")


def test_update_keeps_the_place_unless_the_category_changes() -> None:
    a = create("a", "着彩")
    b = create("b", "着彩")
    create("c", "背景")

    updated = svc.update_prompt(a["id"], "a2", "着彩", "changed").prompt
    assert updated == {"id": a["id"], "name": "a2", "category": "着彩", "text": "changed"}
    assert names() == ["a2", "b", "c"]
    # Keeping its own name is not a duplicate.
    assert svc.update_prompt(b["id"], "b", "着彩", "2").prompt["text"] == "2"

    svc.update_prompt(a["id"], "a2", "背景", "changed")
    assert names() == ["b", "c", "a2"]


def test_move_puts_the_prompt_at_the_end_of_the_category() -> None:
    a = create("a", "着彩")
    create("b", "背景")
    create("c")

    moved = svc.move_prompt(a["id"], "背景").prompt
    assert moved == {**a, "category": "背景"}
    assert names() == ["b", "a", "c"]
    assert svc.list_prompts().categories == ["背景"]  # 着彩 is no longer used

    svc.move_prompt(a["id"], "")
    assert names() == ["b", "c", "a"]


@pytest.mark.parametrize(
    ("name", "category", "text", "message"),
    [
        ("  ", "", "text", "名前を入力"),
        ("x" * 101, "", "text", "100 文字以内"),
        ("name", "x" * 51, "text", "50 文字以内"),
        ("name", "", " \n ", "本文を入力"),
    ],
)
def test_invalid_input(name: str, category: str, text: str, message: str, prompts_file: Path) -> None:
    with pytest.raises(BadRequestError, match=message):
        svc.create_prompt(name, category, text)
    assert not prompts_file.exists()


def test_name_and_category_are_trimmed_and_text_kept_as_is() -> None:
    prompt = create("  名前 ", " 着彩 ", "  本文\n")
    assert (prompt["name"], prompt["category"], prompt["text"]) == ("名前", "着彩", "  本文\n")
    assert create("b", "未分類")["category"] == ""


def test_unknown_id() -> None:
    with pytest.raises(NotFoundError):
        svc.update_prompt("missing", "a", "", "b")
    with pytest.raises(NotFoundError):
        svc.delete_prompt("missing")
    with pytest.raises(NotFoundError):
        svc.duplicate_prompt("missing")
    with pytest.raises(NotFoundError):
        svc.move_prompt("missing", "x")


def test_delete_drops_unused_categories() -> None:
    a = create("a", "着彩")
    create("b", "背景")

    svc.delete_prompt(a["id"])
    store = svc.list_prompts()
    assert (store.categories, [p["name"] for p in store.prompts]) == (["背景"], ["b"])


def test_duplicate_goes_right_after_with_a_free_name() -> None:
    a = create("a", "着彩")
    create("b", "着彩")

    first = svc.duplicate_prompt(a["id"]).prompt
    second = svc.duplicate_prompt(a["id"]).prompt

    assert {k: first[k] for k in ("name", "category", "text")} == {
        "name": "a のコピー",
        "category": "着彩",
        "text": "text",
    }
    assert first["id"] != a["id"]
    assert second["name"] == "a のコピー (2)"
    assert names() == ["a", "a のコピー (2)", "a のコピー", "b"]


def test_duplicate_name_stays_within_the_limit() -> None:
    long = create("x" * 100)
    assert svc.duplicate_prompt(long["id"]).prompt["name"] == "x" * 95 + " のコピー"


def test_reorder_within_a_category() -> None:
    a = create("a", "着彩")
    b = create("b", "背景")
    c = create("c", "着彩")
    d = create("d", "着彩")

    svc.reorder_prompts("着彩", [d["id"], a["id"], c["id"]])
    assert names() == ["d", "a", "c", "b"]

    with pytest.raises(ConflictError, match="読み直して"):
        svc.reorder_prompts("着彩", [d["id"], a["id"]])
    with pytest.raises(ConflictError):
        svc.reorder_prompts("着彩", [d["id"], a["id"], b["id"]])


def test_reorder_uncategorized() -> None:
    a = create("a")
    b = create("b")
    svc.reorder_prompts("", [b["id"], a["id"]])
    assert names() == ["b", "a"]


def test_reorder_categories() -> None:
    create("a", "着彩")
    create("b", "背景")
    create("c")

    svc.reorder_categories(["背景", "着彩"])
    store = svc.list_prompts()
    assert store.categories == ["背景", "着彩"]
    assert names() == ["b", "a", "c"]
    with pytest.raises(ConflictError):
        svc.reorder_categories(["背景"])


def test_rename_category_in_place() -> None:
    create("a", "着彩")
    create("b", "背景")

    svc.rename_category("着彩", "塗り")
    store = svc.list_prompts()
    assert store.categories == ["塗り", "背景"]
    assert [p["category"] for p in store.prompts] == ["塗り", "背景"]


def test_rename_category_into_an_existing_one_merges_at_its_end() -> None:
    create("a", "着彩")
    create("b", "背景")
    create("c", "着彩")
    create("d", "背景")

    svc.rename_category("着彩", "背景")
    store = svc.list_prompts()
    assert store.categories == ["背景"]
    assert names() == ["b", "d", "a", "c"]

    svc.rename_category("背景", "")
    store = svc.list_prompts()
    assert store.categories == []
    assert {p["category"] for p in store.prompts} == {""}


def test_rename_unknown_category() -> None:
    with pytest.raises(NotFoundError):
        svc.rename_category("missing", "x")
    with pytest.raises(NotFoundError):
        svc.rename_category("", "x")


def test_import_adds_and_handles_conflicts() -> None:
    a = create("a", "着彩", "old")
    items = [
        {"name": "a", "category": "背景", "text": "new"},
        {"name": "b", "category": "新規", "text": "b"},
        {"name": "b", "text": "again"},
        {"name": "", "text": "x"},
        {"name": "c"},
        "bad",
    ]

    skipped = svc.import_prompts(items, ["新規", "背景"], "skip")
    assert (skipped.added, skipped.overwritten, skipped.skipped, skipped.invalid) == (1, 0, 2, 3)
    store = svc.list_prompts()
    assert store.categories == ["着彩", "新規"]
    assert [(p["name"], p["text"]) for p in store.prompts] == [("a", "old"), ("b", "b")]

    renamed = svc.import_prompts(items, [], "rename")
    assert (renamed.added, renamed.skipped) == (3, 0)
    assert names() == ["a", "b", "b (2)", "a (2)", "b (3)"]

    overwritten = svc.import_prompts(items[:1], [], "overwrite")
    assert overwritten.overwritten == 1
    store = svc.list_prompts()
    prompt = next(p for p in store.prompts if p["id"] == a["id"])
    assert (prompt["category"], prompt["text"]) == ("背景", "new")


def test_import_reads_an_exported_file_back(prompts_file: Path) -> None:
    create("a", "着彩")
    create("b", "背景")
    store = svc.list_prompts()
    exported = [{k: p[k] for k in ("name", "category", "text")} for p in store.prompts]
    prompts_file.unlink()

    assert svc.import_prompts(exported, store.categories, "skip").added == 2
    after = svc.list_prompts()
    assert after.categories == store.categories
    assert [{k: p[k] for k in ("name", "category", "text")} for p in after.prompts] == exported


def test_broken_file_is_moved_aside_with_a_warning(prompts_file: Path) -> None:
    prompts_file.parent.mkdir(parents=True)
    prompts_file.write_text("{broken", encoding="utf-8")

    result = svc.list_prompts()

    assert result.prompts == []
    backups = list(prompts_file.parent.glob("prompts.broken-*.json"))
    assert len(backups) == 1 and backups[0].read_text(encoding="utf-8") == "{broken"
    assert result.warnings == [
        f"プロンプトファイル（prompts.json）が壊れていたため {backups[0].name} に退避し、登録プロンプトなしで読み込みました。"
    ]


def test_a_file_edited_outside_the_app_is_normalized(prompts_file: Path) -> None:
    good = {"id": "1", "name": "ok", "category": "背景", "text": "t"}
    write(
        prompts_file,
        {
            "categories": ["着彩", "背景", 3, "背景"],
            "prompts": [
                {"id": "0", "name": "no category", "text": "t"},
                {"id": "2", "name": 3},
                "x",
                good,
                {"id": "3", "name": "new", "category": "新規", "text": "t"},
            ],
        },
    )

    store = svc.list_prompts()
    assert store.categories == ["背景", "新規"]
    assert [p["id"] for p in store.prompts] == ["1", "3", "0"]
    assert store.prompts[2]["category"] == ""


def test_the_old_settings_file_is_not_read(data_dir: Path) -> None:
    old = data_dir / "settings" / "prompts.json"
    write(old, {"nanoBananaPro": [{"id": "1", "name": "a", "text": "t"}]})

    assert svc.list_prompts().prompts == []
    create("b")
    assert read(old) == {"nanoBananaPro": [{"id": "1", "name": "a", "text": "t"}]}
