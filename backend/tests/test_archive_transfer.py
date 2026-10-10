import io
import json
import zipfile
from datetime import datetime
from pathlib import Path

import pytest

from src.app.services import archive_service as svc
from src.app.services import archive_transfer as transfer
from src.app.services import flow_service

from .conftest import make_png


def _archive_with_flow(archives_dir: Path) -> str:
    """An imported page with a コマ分割, a 背景除去 of its first panel and a selection in .flow.json."""
    page = svc.save_result(None, "20260101_100000_page", [("page.png", make_png(4, 4))])
    split = svc.save_result(
        page,
        "20260101_100100_コマ分割",
        [("01.png", make_png(2, 2)), ("panels.json", b"{}")],
        {"tool": "コマ分割", "source": f"{page}/page.png", "settings": {}},
    )
    nobg = svc.save_result(
        page,
        "20260101_100200_背景除去",
        [("nobg.png", make_png(2, 2))],
        {"tool": "背景除去", "source": f"{split}/01.png", "settings": {}, "sources": [f"{split}/01.png"]},
    )
    svc.save_result(
        page,
        "20260101_100300_コマ結合",
        [("merged.png", make_png(4, 4))],
        {"tool": "コマ結合", "source": split, "settings": {"panels": {"01.png": f"{nobg}/nobg.png"}, "note": "x"}},
    )
    flow_service.set_selection(page, f"{split}/01.png|背景除去", nobg)
    flow_service.set_selection(page, f"|コマ分割|{split}", split)
    return page


def test_import_keeps_the_dates_of_result_folders_without_info(archives_dir: Path, tmp_path: Path) -> None:
    import os

    svc.save_archive("p", [("page.png", make_png(1, 1)), ("20260101_090000_x/01.png", make_png(1, 1))])
    os.utime(archives_dir / "p" / "20260101_090000_x", (1_700_000_000, 1_700_000_000))
    before = flow_service.get_flow("p")

    _import(_export(["p"], tmp_path))

    after = flow_service.get_flow("p_2")
    assert after["runs"][0]["created_at"] == before["runs"][0]["created_at"]
    assert (archives_dir / "p_2").stat().st_mtime > 1_700_000_000  # the archive itself: imported now


def _export(names: list[str], tmp_path: Path) -> Path:
    dest = tmp_path / "out.zip"
    transfer.export_archives(names, dest)
    return dest


def _import(path: Path, name: str = "in.zip") -> transfer.ImportResult:
    with path.open("rb") as f:
        return transfer.import_zip(f, name)


def test_export_layout(archives_dir: Path, tmp_path: Path) -> None:
    page = _archive_with_flow(archives_dir)
    svc.save_archive("plain", [("a.png", make_png(1, 1))])

    dest = tmp_path / "out.zip"
    name = transfer.export_archives([page, "plain", page], dest, datetime(2026, 1, 2, 3, 4, 5))

    assert name == "confeito-archives-20260102_030405.zip"
    with zipfile.ZipFile(dest) as zf:
        manifest = json.loads(zf.read("manifest.json"))
        names = set(zf.namelist())
        stored = zf.getinfo(f"{page}/page.png").compress_type
    assert manifest["format"] == "confeito-archives" and manifest["version"] == 1
    assert [(a["id"], a["name"]) for a in manifest["archives"]] == [(page, "page"), ("plain", "plain")]
    assert {f"{page}/.archive.json", f"{page}/.flow.json", f"{page}/20260101_100100_コマ分割/info.json"} <= names
    assert "plain/.archive.json" in names  # written from the fallback so the name travels
    assert stored == zipfile.ZIP_STORED
    assert not (archives_dir / "plain" / ".archive.json").exists()  # the archive itself is not changed


def test_export_file_name_for_one_archive() -> None:
    assert transfer.export_file_name(['第1話: "下塗り"'], datetime(2026, 1, 2, 3, 4, 5)) == (
        "confeito-archive-第1話_ _下塗り_-20260102_030405.zip"
    )


def test_export_refuses_nothing_and_missing(archives_dir: Path, tmp_path: Path) -> None:
    with pytest.raises(svc.ArchiveValidationError):
        transfer.export_archives([], tmp_path / "a.zip")
    with pytest.raises(svc.ArchiveNotFoundError):
        transfer.export_archives(["missing"], tmp_path / "a.zip")


def test_round_trip_into_an_empty_folder(archives_dir: Path, tmp_path: Path) -> None:
    page = _archive_with_flow(archives_dir)
    svc.rename_archive(page, "第1話")
    before = flow_service.get_flow(page)
    dest = _export([page], tmp_path)
    svc.delete_archive(page)

    result = _import(dest)

    assert result.imported == [{"key": page, "name": "第1話"}]
    assert result.warnings == []
    assert flow_service.get_flow(page) == before
    assert not [p for p in archives_dir.iterdir() if p.name.startswith(".import-")]


def test_import_next_to_the_original_rewrites_keys(archives_dir: Path, tmp_path: Path) -> None:
    page = _archive_with_flow(archives_dir)
    before = flow_service.get_flow(page)
    dest = _export([page], tmp_path)

    result = _import(dest)
    copy = f"{page}_2"

    assert result.imported == [{"key": copy, "name": "page (2)"}]
    after = flow_service.get_flow(copy)
    as_copy = json.loads(json.dumps(before).replace(f"{page}/", f"{copy}/").replace(f'"{page}"', f'"{copy}"'))
    assert after == as_copy
    assert after["selection"][f"|コマ分割|{copy}/20260101_100100_コマ分割"] == f"{copy}/20260101_100100_コマ分割"
    merge = next(r for r in after["runs"] if r["tool"] == "コマ結合")
    assert merge["settings"] == {"panels": {"01.png": f"{copy}/20260101_100200_背景除去/nobg.png"}, "note": "x"}
    assert flow_service.get_flow(page) == before  # the original is untouched
    # A second import is a third archive.
    assert _import(dest).imported == [{"key": f"{page}_3", "name": "page (3)"}]


def _zip(entries: dict[str, bytes], path: Path) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        for name, content in entries.items():
            zf.writestr(name, content)
    return path


def test_import_archives_folder_without_manifest(archives_dir: Path, tmp_path: Path) -> None:
    src = _zip(
        {
            "20260101_100000_a/a.png": make_png(1, 1),
            "20260101_100000_a/sub/info.json": b"{}",
            "b/b.png": make_png(1, 1),
            ".trash/old/x.png": b"x",
        },
        tmp_path / "folders.zip",
    )

    result = _import(src)

    assert sorted((a["key"], a["name"]) for a in result.imported) == [
        ("20260101_100000_a", "20260101_100000_a"),
        ("b", "b"),
    ]
    assert (archives_dir / "20260101_100000_a" / "sub" / "info.json").exists()
    assert not (archives_dir / ".trash").exists()


def test_import_files_at_the_top_as_one_archive(archives_dir: Path, tmp_path: Path) -> None:
    src = _zip({"p1.png": make_png(1, 1), "p2.png": make_png(1, 1)}, tmp_path / "第2話.zip")

    result = _import(src, "第2話.zip")

    assert result.imported == [{"key": "第2話", "name": "第2話"}]
    assert sorted(p.name for p in (archives_dir / "第2話").iterdir()) == [".archive.json", "p1.png", "p2.png"]


def test_import_skips_paths_outside_the_archive(archives_dir: Path, tmp_path: Path) -> None:
    src = _zip({"a/ok.png": b"1", "a/../../evil.png": b"x", "/abs/x.png": b"x", "C:/x/y.png": b"x"}, tmp_path / "z.zip")

    result = _import(src)

    assert result.imported == [{"key": "a", "name": "a"}]
    assert result.skipped_files == 3
    assert result.warnings == ["読み込めなかったファイル 3 件は外しました。"]
    assert not (tmp_path / "evil.png").exists() and not (archives_dir.parent / "evil.png").exists()


@pytest.mark.parametrize("content", [b"not a zip", b""])
def test_import_refuses_what_is_not_a_zip(archives_dir: Path, content: bytes) -> None:
    with pytest.raises(svc.ArchiveValidationError):
        transfer.import_zip(io.BytesIO(content), "x.zip")


def test_import_refuses_a_zip_without_archives(archives_dir: Path, tmp_path: Path) -> None:
    src = _zip({".trash/a/x.png": b"x"}, tmp_path / "z.zip")
    with pytest.raises(svc.ArchiveValidationError):
        _import(src)


def test_export_and_import_routes(client, archives_dir: Path) -> None:
    page = _archive_with_flow(archives_dir)

    res = client.post("/api/archives/export", json={"names": [page]})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"
    assert res.headers["x-file-name"].startswith("confeito-archive-page-")

    res = client.post("/api/archives/import", files={"file": ("x.zip", res.content, "application/zip")})
    assert res.status_code == 200
    assert res.json() == {"imported": [{"key": f"{page}_2", "name": "page (2)"}], "skipped_files": 0, "warnings": []}

    assert client.post("/api/archives/import", files={"file": ("x.zip", b"nope")}).status_code == 400
    assert client.post("/api/archives/export", json={"names": ["missing"]}).status_code == 404


def test_rename_route(client, archives_dir: Path) -> None:
    svc.save_archive("a", [("a.png", b"1")])
    svc.save_archive("b", [("b.png", b"1")])

    assert client.put("/api/archives/a/meta", json={"name": "新しい名前"}).json()["name"] == "新しい名前"
    assert client.put("/api/archives/b/meta", json={"name": "新しい名前"}).status_code == 409
    assert client.put("/api/archives/b/meta", json={"name": " "}).status_code == 400
    assert {e["name"] for e in client.get("/api/archives").json()} == {"b", "新しい名前"}


def test_export_images_side_by_side(archives_dir: Path, tmp_path: Path) -> None:
    page = _archive_with_flow(archives_dir)
    other = svc.save_result(None, "20260101_110000_page", [("page.png", make_png(1, 1))])
    keys = [f"{page}/20260101_100200_背景除去/nobg.png", f"{page}/page.png", f"{other}/page.png", f"{page}/page.png"]

    name = transfer.export_images(keys, tmp_path / "i.zip", datetime(2026, 1, 2, 3, 4, 5))

    assert name == "confeito-images-20260102_030405.zip"
    with zipfile.ZipFile(tmp_path / "i.zip") as zf:
        assert zf.namelist() == ["20260101_100200_背景除去_nobg.png", "page.png", "page_2.png"]
    with pytest.raises(svc.ArchiveNotFoundError):
        transfer.export_images([f"{page}/missing.png"], tmp_path / "x.zip")
    with pytest.raises(svc.ArchiveNotFoundError):
        transfer.export_images([page], tmp_path / "x.zip")  # an archive is not an image


def test_details_route(client, archives_dir: Path) -> None:
    page = _archive_with_flow(archives_dir)
    (archives_dir / "empty").mkdir()

    rows = {r["key"]: r for r in client.get("/api/archives/details").json()}

    assert rows[page]["name"] == "page"
    assert (rows[page]["images"], rows[page]["results"], rows[page]["cover"]) == (4, 3, f"{page}/page.png")
    assert rows[page]["size"] > 0 and rows[page]["created_at"] == rows[page]["created_at"][:19]
    assert (rows["empty"]["images"], rows["empty"]["cover"]) == (0, None)

    res = client.post("/api/archives/export-images", json={"keys": [f"{page}/page.png"]})
    assert res.status_code == 200 and res.headers["x-file-name"].startswith("confeito-images-")
