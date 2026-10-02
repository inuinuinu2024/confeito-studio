import io
import json
from pathlib import Path

import pytest
from PIL import Image

from src.app.services import merge_service
from src.app.services.archive_service import save_archive

from .conftest import make_png

PANELS_JSON = {
    "image_size": {"width": 20, "height": 10},
    "panels": [
        {"filename": "01.png", "pixel_box": [0, 0, 10, 10]},
        {"filename": "02.png", "xywh": [10, 0, 10, 10]},
    ],
}


def _make_split_folder(prefix: str) -> None:
    save_archive(
        "page",
        [
            (f"{prefix}01.png", make_png(10, 10, (255, 0, 0, 255))),
            (f"{prefix}02.png", make_png(10, 10, (0, 0, 255, 255))),
            (f"{prefix}panels.json", json.dumps(PANELS_JSON).encode()),
            ("log.txt", b"[init]\n"),
        ],
    )


def test_merge_subfolder_saves_into_parent(archives_dir: Path) -> None:
    _make_split_folder("split/")

    result = merge_service.merge_panels("page/split")

    assert result["parent_folder"] == "page"
    assert result["filename"].endswith("_コマ結合.png")
    assert result["auto_select_key"] == f"page/{result['filename']}"
    merged = Image.open(archives_dir / "page" / result["filename"])
    assert merged.size == (20, 10)
    assert merged.getpixel((2, 2)) == (255, 0, 0, 255)
    assert merged.getpixel((15, 5)) == (0, 0, 255, 255)
    assert "コマ結合ツールを実行し、2個のコマを結合しました（対象フォルダ: page/split" in (
        archives_dir / "page" / "log.txt"
    ).read_text(encoding="utf-8")


def test_merge_root_archive_creates_new_archive(archives_dir: Path) -> None:
    _make_split_folder("")

    result = merge_service.merge_panels("page")

    new_root = result["parent_folder"]
    assert new_root.endswith("_コマ結合") and new_root != "page"
    assert result["auto_select_key"] == f"{new_root}/{result['filename']}"
    assert Image.open(io.BytesIO((archives_dir / new_root / result["filename"]).read_bytes())).size == (20, 10)
    assert "コマ結合ツールを実行" in (archives_dir / "page" / "log.txt").read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("target", "message"),
    [("", "対象フォルダが指定されていません"), ("missing", "panels.json が見つかりません")],
)
def test_merge_errors(target: str, message: str) -> None:
    with pytest.raises(merge_service.MergeServiceError, match=message):
        merge_service.merge_panels(target)


def test_merge_reports_missing_panel_image() -> None:
    save_archive("page", [("panels.json", json.dumps(PANELS_JSON).encode())])
    with pytest.raises(merge_service.MergeServiceError, match=r"コマ画像 \(01.png\) がフォルダ内に見つかりません"):
        merge_service.merge_panels("page")
