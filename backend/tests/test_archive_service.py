from pathlib import Path

import pytest

from src.app.services import archive_service as svc


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


def test_restore_contents_replaces_newer_file_and_reports_missing(archives_dir: Path) -> None:
    svc.save_archive("a", [("x.png", b"old"), ("y.png", b"")])
    svc.delete_archive_contents("a", ["x.png"])
    svc.save_archive("a", [("x.png", b"new")])
    svc.restore_archive_contents("a", ["x.png"])
    assert (archives_dir / "a" / "x.png").read_bytes() == b"old"

    with pytest.raises(svc.ArchiveNotFoundError):
        svc.restore_archive_contents("a", ["x.png"])
    with pytest.raises(svc.ArchiveValidationError):
        svc.restore_archive_contents("a", ["../b/x.png"])


def test_append_log_adds_newline(archives_dir: Path) -> None:
    svc.save_archive("a", [("log.txt", b"first\n")])
    svc.append_archive_log("a", "second")
    svc.append_archive_log("a", "third\n", "error.txt")
    assert (archives_dir / "a" / "log.txt").read_text(encoding="utf-8") == "first\nsecond\n"
    assert (archives_dir / "a" / "error.txt").read_text(encoding="utf-8") == "third\n"


def test_split_archive_path() -> None:
    assert svc.split_archive_path("root/sub/file.png") == ("root", "sub/file.png")
    assert svc.split_archive_path("\\root\\sub\\") == ("root", "sub")
    assert svc.split_archive_path("root") == ("root", "")
    assert svc.split_archive_path("") == ("", "")
