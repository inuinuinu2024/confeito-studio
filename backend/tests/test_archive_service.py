import json
from datetime import datetime
from pathlib import Path

import pytest

from src.app.services import archive_service as svc


def test_save_result_inside_the_top_level_of_the_selected_archive(archives_dir: Path) -> None:
    svc.save_archive("page", [("page.png", b"png")])
    info: svc.ResultInfo = {"tool": "背景除去", "source": "page/page.png", "settings": {"erode_size": 10}}

    key = svc.save_result("page/sub", "20260101_100000_背景除去", [("nobg.png", b"x")], info, datetime(2026, 1, 1))

    assert key == "page/20260101_100000_背景除去"
    assert (archives_dir / key / "nobg.png").read_bytes() == b"x"
    assert json.loads((archives_dir / key / "info.json").read_text(encoding="utf-8")) == {
        "tool": "背景除去",
        "created_at": "2026-01-01 00:00:00",
        "source": "page/page.png",
        "settings": {"erode_size": 10},
        "outputs": ["nobg.png"],
    }


def test_save_result_never_overwrites(archives_dir: Path) -> None:
    keys = [svc.save_result(None, "20260101_100000_x", [("a.png", bytes([i]))]) for i in range(3)]
    keys.append(svc.save_result("20260101_100000_x", "r", [("a.png", b"")]))
    keys.append(svc.save_result("20260101_100000_x", "r", [("a.png", b"")]))

    assert keys == [
        "20260101_100000_x",
        "20260101_100000_x_2",
        "20260101_100000_x_3",
        "20260101_100000_x/r",
        "20260101_100000_x/r_2",
    ]
    assert (archives_dir / "20260101_100000_x_2" / "a.png").read_bytes() == b"\x01"
    assert not (archives_dir / "20260101_100000_x" / "info.json").exists()  # no info -> no info.json


@pytest.mark.parametrize(("text", "valid"), [(None, True), ('{"tool": "t", "settings": {"a": 1}}', True), ("{", False)])
def test_parse_result_info(text: str | None, valid: bool) -> None:
    if valid:
        info = svc.parse_result_info(text)
        assert info is None or info == {"tool": "t", "source": None, "settings": {"a": 1}}
    else:
        with pytest.raises(svc.ArchiveValidationError):
            svc.parse_result_info(text)


def test_save_and_list_contents(archives_dir: Path) -> None:
    svc.save_archive("a1", [("img.png", b"png"), ("sub/deep/x.json", b"{}"), ("log.txt", b"hello\n")])

    assert [e["key"] for e in svc.list_archives()] == ["a1"]
    root = svc.list_archives()[0]
    assert root["type"] == "folder" and root["folderId"] is None and root["collapsed"] is True

    entries = {e["key"]: e for e in svc.list_archive_contents("a1")}
    assert entries["a1/img.png"]["folderId"] == "a1"
    assert entries["a1/img.png"]["type"] == "image"
    assert entries["a1/sub"]["type"] == "folder"
    assert entries["a1/sub"]["folderId"] == "a1"
    assert entries["a1/sub/deep"]["folderId"] == "a1/sub"
    assert entries["a1/sub/deep/x.json"]["folderId"] == "a1/sub/deep"
    assert (archives_dir / "a1" / "sub" / "deep" / "x.json").read_bytes() == b"{}"


def test_list_archives_hides_dot_folders_and_sorts_newest_first(archives_dir: Path) -> None:
    import os

    svc.save_archive("old", [("a.txt", b"1")])
    svc.save_archive("new", [("a.txt", b"1")])
    os.utime(archives_dir / "old", (1_000_000, 1_000_000))
    (archives_dir / ".trash").mkdir()

    assert [e["key"] for e in svc.list_archives()] == ["new", "old"]


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("x.png", "image/png"),
        ("x.JPG", "image/jpeg"),
        ("x.json", "application/json"),
        ("x.md", "text/plain"),
        ("x.bin", "application/octet-stream"),
    ],
)
def test_extract_file_mime_types(name: str, expected: str) -> None:
    svc.save_archive("a", [(name, b"data")])
    assert svc.extract_file("a", name) == (b"data", expected)


@pytest.mark.parametrize("bad_name", ["", "..", ".trash", ".items", "a/b", "a\\b"])
def test_invalid_archive_names_are_rejected(bad_name: str) -> None:
    with pytest.raises(svc.ArchiveValidationError):
        svc.save_archive(bad_name, [("x.txt", b"")])


@pytest.mark.parametrize("bad_path", ["../other/x.png", "sub/../../other/x.png", "."])
def test_path_traversal_is_rejected(bad_path: str) -> None:
    svc.save_archive("a", [("x.png", b"")])
    with pytest.raises(svc.ArchiveValidationError):
        svc.extract_file("a", bad_path)


def test_missing_archive_and_file_raise_not_found() -> None:
    with pytest.raises(svc.ArchiveNotFoundError):
        svc.list_archive_contents("nope")
    svc.save_archive("a", [("x.png", b"")])
    with pytest.raises(svc.ArchiveNotFoundError):
        svc.extract_file("a", "missing.png")


def test_delete_moves_to_trash_and_restore(archives_dir: Path) -> None:
    svc.save_archive("a", [("x.png", b"1")])
    svc.delete_archive("a")
    assert not (archives_dir / "a").exists()
    assert (archives_dir / ".trash" / "a" / "x.png").exists()

    svc.restore_archive("a")
    assert (archives_dir / "a" / "x.png").read_bytes() == b"1"
    with pytest.raises(svc.ArchiveNotFoundError):
        svc.restore_archive("a")


def test_restore_keeps_newer_archive_with_the_same_name(archives_dir: Path) -> None:
    svc.save_archive("a", [("x.png", b"old")])
    svc.delete_archive("a")
    svc.save_archive("a", [("y.png", b"new")])
    with pytest.raises(svc.ArchiveConflictError):
        svc.restore_archive("a")
    assert sorted(p.name for p in (archives_dir / "a").iterdir()) == ["y.png"]
    assert (archives_dir / ".trash" / "a" / "x.png").read_bytes() == b"old"


def test_delete_contents_moves_items_to_trash_and_prunes(archives_dir: Path) -> None:
    svc.save_archive("a", [("keep.png", b"k"), ("sub/x.png", b"x")])
    svc.delete_archive_contents("a", ["sub/x.png"])
    assert not (archives_dir / "a" / "sub").exists()
    assert (archives_dir / "a" / "keep.png").exists()
    assert (archives_dir / ".trash" / ".items" / "a" / "sub" / "x.png").read_bytes() == b"x"

    # Deleting the last entry removes the (empty) archive folder; its items stay in the trash.
    svc.delete_archive_contents("a", ["keep.png"])
    assert not (archives_dir / "a").exists()
    assert svc.list_archives() == []

    svc.restore_archive_contents("a", ["keep.png", "sub/x.png"])
    assert (archives_dir / "a" / "keep.png").read_bytes() == b"k"
    assert (archives_dir / "a" / "sub" / "x.png").read_bytes() == b"x"
    assert not (archives_dir / ".trash" / ".items" / "a").exists()


def test_delete_contents_handles_nested_selection(archives_dir: Path) -> None:
    # A folder and a file inside it selected together: the folder is trashed once, with the file.
    svc.save_archive("a", [("sub/01.png", b"1"), ("sub/02.png", b"2"), ("log.txt", b"")])
    svc.delete_archive_contents("a", ["sub/01.png", "sub"])
    assert sorted(p.name for p in (archives_dir / ".trash" / ".items" / "a" / "sub").iterdir()) == ["01.png", "02.png"]

    svc.restore_archive_contents("a", ["sub/01.png", "sub"])
    assert sorted(p.name for p in (archives_dir / "a" / "sub").iterdir()) == ["01.png", "02.png"]


def test_restore_contents_keeps_newer_file_and_reports_missing(archives_dir: Path) -> None:
    svc.save_archive("a", [("x.png", b"old"), ("y.png", b"")])
    svc.delete_archive_contents("a", ["x.png"])
    svc.save_archive("a", [("x.png", b"new")])
    # Something with the same name is there: nothing is replaced and the deleted file stays in the trash.
    with pytest.raises(svc.ArchiveConflictError):
        svc.restore_archive_contents("a", ["x.png"])
    assert (archives_dir / "a" / "x.png").read_bytes() == b"new"
    assert (archives_dir / ".trash" / ".items" / "a" / "x.png").read_bytes() == b"old"

    (archives_dir / "a" / "x.png").unlink()
    svc.restore_archive_contents("a", ["x.png"])
    assert (archives_dir / "a" / "x.png").read_bytes() == b"old"

    with pytest.raises(svc.ArchiveNotFoundError):
        svc.restore_archive_contents("a", ["x.png"])
    with pytest.raises(svc.ArchiveValidationError):
        svc.restore_archive_contents("a", ["../b/x.png"])


def test_empty_trash_removes_deleted_archives_and_items(archives_dir: Path) -> None:
    assert svc.empty_trash() == []  # no .trash yet
    svc.save_archive("a", [("x.png", b"1")])
    svc.save_archive("b", [("sub/y.png", b"2"), ("keep.png", b"3")])
    svc.delete_archive("a")
    svc.delete_archive_contents("b", ["sub"])

    assert svc.empty_trash() == []
    assert list((archives_dir / ".trash").iterdir()) == []
    assert (archives_dir / "b" / "keep.png").read_bytes() == b"3"
    with pytest.raises(svc.ArchiveNotFoundError):
        svc.restore_archive("a")


def test_split_archive_path() -> None:
    assert svc.split_archive_path("root/sub/file.png") == ("root", "sub/file.png")
    assert svc.split_archive_path("\\root\\sub\\") == ("root", "sub")
    assert svc.split_archive_path("root") == ("root", "")
    assert svc.split_archive_path("") == ("", "")


# ── Display name (.archive.json) ─────────────────────────────────────


def test_new_archive_gets_a_display_name_without_the_stamp(archives_dir: Path) -> None:
    first = svc.save_result(None, "20260102_030405_page", [("page.png", b"1")], now=datetime(2026, 1, 2, 3, 4, 5))
    second = svc.save_result(None, "20260102_030405_page", [("page.png", b"2")])

    assert [first, second] == ["20260102_030405_page", "20260102_030405_page_2"]
    assert svc.read_meta(first) == {"name": "page", "created_at": "2026-01-02 03:04:05"}
    assert svc.read_meta(second)["name"] == "page (2)"
    meta = json.loads((archives_dir / first / ".archive.json").read_text(encoding="utf-8"))
    assert meta["format"] == "confeito-archive" and meta["version"] == 1
    assert {e["key"]: e["name"] for e in svc.list_archives()} == {first: "page", second: "page (2)"}
    # Hidden like .flow.json; a result inside an archive does not get one.
    assert all(e["name"] != ".archive.json" for e in svc.list_archive_contents(first))
    key = svc.save_result(first, "20260102_030500_背景除去", [("nobg.png", b"x")])
    assert not (archives_dir / key / ".archive.json").exists()


def test_archive_without_meta_shows_its_folder_name(archives_dir: Path) -> None:
    svc.save_archive("20260101_100000_old", [("a.png", b"1")])
    svc.save_archive("plain", [("a.png", b"1")])
    (archives_dir / "broken").mkdir()
    (archives_dir / "broken" / ".archive.json").write_text("{", encoding="utf-8")

    assert svc.read_meta("20260101_100000_old") == {"name": "20260101_100000_old", "created_at": "2026-01-01 10:00:00"}
    assert svc.read_meta("plain")["name"] == "plain"
    assert svc.read_meta("plain")["created_at"]  # the folder's modification time
    assert svc.read_meta("broken")["name"] == "broken"


def test_rename_archive(archives_dir: Path) -> None:
    svc.save_archive("a", [("a.png", b"1")])
    svc.save_archive("b", [("b.png", b"1")])

    assert svc.rename_archive("a", "  第1話  ")["name"] == "第1話"
    assert svc.read_meta("a")["name"] == "第1話"
    assert (archives_dir / "a" / "a.png").exists()  # the folder (id) stays
    assert svc.rename_archive("a", "第1話")["name"] == "第1話"  # same name: nothing changes
    with pytest.raises(svc.ArchiveConflictError):
        svc.rename_archive("b", "第1話")
    for bad in ["", "   ", "x" * 101, "a\nb"]:
        with pytest.raises(svc.ArchiveValidationError):
            svc.rename_archive("b", bad)
    with pytest.raises(svc.ArchiveNotFoundError):
        svc.rename_archive("missing", "x")


def test_long_name_is_cut(archives_dir: Path) -> None:
    key = svc.save_result(None, "20260101_100000_" + "長" * 105, [("a.png", b"1")])
    assert svc.read_meta(key)["name"] == "長" * 100
