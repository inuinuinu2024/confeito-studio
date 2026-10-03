"""Registered prompts per tool (settings/prompts.json)."""

import json
from pathlib import Path

import pytest

from src.app.errors import BadRequestError, NotFoundError
from src.app.services import prompt_service as svc


@pytest.fixture
def prompts_file(data_dir: Path) -> Path:
    return data_dir / "settings" / "prompts.json"


def read(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def test_create_appends_in_order_and_writes_atomically(prompts_file: Path) -> None:
    a = svc.create_prompt("toolA", "一つ目", "text 1").prompt
    b = svc.create_prompt("toolA", "二つ目", "text 2").prompt

    assert a["id"] != b["id"]
    assert svc.list_prompts("toolA").prompts == [a, b]
    assert read(prompts_file) == {"toolA": [a, b]}
    assert not prompts_file.with_name("prompts.json.tmp").exists()


def test_tools_have_their_own_lists(prompts_file: Path) -> None:
    a = svc.create_prompt("toolA", "同じ名前", "a").prompt
    b = svc.create_prompt("toolB", "同じ名前", "b").prompt

    assert svc.list_prompts("toolA").prompts == [a]
    assert svc.list_prompts("toolB").prompts == [b]
    svc.delete_prompt("toolA", a["id"])
    assert read(prompts_file) == {"toolA": [], "toolB": [b]}


def test_update_keeps_the_place_and_id() -> None:
    a = svc.create_prompt("toolA", "a", "1").prompt
    b = svc.create_prompt("toolA", "b", "2").prompt

    updated = svc.update_prompt("toolA", a["id"], "a2", "1 changed").prompt

    assert updated == {"id": a["id"], "name": "a2", "text": "1 changed"}
    assert svc.list_prompts("toolA").prompts == [updated, b]
    # Keeping its own name is not a duplicate.
    assert svc.update_prompt("toolA", b["id"], "b", "2 changed").prompt["text"] == "2 changed"


def test_names_must_be_unique_within_a_tool() -> None:
    a = svc.create_prompt("toolA", "a", "1").prompt
    svc.create_prompt("toolA", "b", "2")

    with pytest.raises(BadRequestError, match="同じ名前"):
        svc.create_prompt("toolA", " a ", "x")
    with pytest.raises(BadRequestError, match="同じ名前"):
        svc.update_prompt("toolA", a["id"], "b", "x")


@pytest.mark.parametrize(
    ("name", "text", "message"),
    [
        ("  ", "text", "名前を入力"),
        ("x" * 101, "text", "100 文字以内"),
        ("name", " \n ", "本文を入力"),
    ],
)
def test_invalid_name_or_text(name: str, text: str, message: str, prompts_file: Path) -> None:
    with pytest.raises(BadRequestError, match=message):
        svc.create_prompt("toolA", name, text)
    assert not prompts_file.exists()


def test_name_is_trimmed_and_text_kept_as_is() -> None:
    prompt = svc.create_prompt("toolA", "  名前 ", "  本文\n").prompt
    assert (prompt["name"], prompt["text"]) == ("名前", "  本文\n")


def test_unknown_id_and_bad_tool_name() -> None:
    with pytest.raises(NotFoundError):
        svc.update_prompt("toolA", "missing", "a", "b")
    with pytest.raises(NotFoundError):
        svc.delete_prompt("toolA", "missing")
    with pytest.raises(BadRequestError):
        svc.list_prompts("../evil")


def test_broken_file_is_moved_aside_with_a_warning(prompts_file: Path) -> None:
    prompts_file.parent.mkdir(parents=True)
    prompts_file.write_text("{broken", encoding="utf-8")

    result = svc.list_prompts("toolA")

    assert result.prompts == []
    backups = list(prompts_file.parent.glob("prompts.broken-*.json"))
    assert len(backups) == 1 and backups[0].read_text(encoding="utf-8") == "{broken"
    assert result.warnings == [
        f"プロンプトファイル（prompts.json）が壊れていたため {backups[0].name} に退避し、登録プロンプトなしで読み込みました。"
    ]


def test_malformed_entries_are_skipped(prompts_file: Path) -> None:
    prompts_file.parent.mkdir(parents=True)
    good = {"id": "1", "name": "ok", "text": "t"}
    prompts_file.write_text(
        json.dumps({"toolA": [good, {"id": "2", "name": 3}, "x"], "toolB": "not a list"}), encoding="utf-8"
    )

    assert svc.list_prompts("toolA").prompts == [good]
    assert svc.list_prompts("toolB").prompts == []
