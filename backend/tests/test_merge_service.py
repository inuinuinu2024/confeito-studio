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


def test_merge_saves_into_a_result_folder_of_the_archive(archives_dir: Path) -> None:
    _make_split_folder("split/")

    result = merge_service.merge_panels("page/split")

    folder = result["folder"]
    assert folder.startswith("page/") and folder.endswith("_コマ結合")
    assert result["filename"] == f"{folder.split('/')[1]}.png"
    assert result["auto_select_key"] == f"{folder}/{result['filename']}"
    merged = Image.open(archives_dir / folder / result["filename"])
    assert merged.size == (20, 10)
    assert merged.getpixel((2, 2)) == (255, 0, 0, 255)
    assert merged.getpixel((15, 5)) == (0, 0, 255, 255)
    info = json.loads((archives_dir / folder / "info.json").read_text(encoding="utf-8"))
    assert info["tool"] == "コマ結合" and info["source"] == "page/split"
    assert info["outputs"] == [result["filename"]]
    # No log is written (docs/specs/notifications.md): the existing log.txt stays as it was.
    assert (archives_dir / "page" / "log.txt").read_text(encoding="utf-8") == "[init]\n"


def test_merge_of_a_top_level_split_stays_in_that_archive(archives_dir: Path) -> None:
    _make_split_folder("")

    result = merge_service.merge_panels("page")

    assert result["folder"].startswith("page/")
    assert Image.open(io.BytesIO((archives_dir / result["auto_select_key"]).read_bytes())).size == (20, 10)
    assert {p.name for p in (archives_dir / result["folder"]).iterdir()} == {result["filename"], "info.json"}


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
