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
    assert info["sources"] == ["page/split/01.png", "page/split/02.png"]
    assert info["settings"] == {}
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
    [("", "対象のコマ分割が指定されていません"), ("missing", "panels.json が見つかりません")],
)
def test_merge_errors(target: str, message: str) -> None:
    with pytest.raises(merge_service.MergeServiceError, match=message):
        merge_service.merge_panels(target)


def test_merge_reports_missing_panel_image() -> None:
    save_archive("page", [("panels.json", json.dumps(PANELS_JSON).encode())])
    with pytest.raises(merge_service.MergeServiceError, match=r"コマ画像 \(01.png\) がフォルダ内に見つかりません"):
        merge_service.merge_panels("page")


def test_merge_replaces_panels_with_overrides_resized_to_the_panel(archives_dir: Path) -> None:
    _make_split_folder("split/")
    save_archive("page", [("colored/big.png", make_png(40, 40, (0, 255, 0, 255)))])

    result = merge_service.merge_panels("page/split", {"02.png": "page/colored/big.png"})

    merged = Image.open(archives_dir / result["auto_select_key"])
    assert merged.getpixel((2, 2)) == (255, 0, 0, 255)
    assert merged.getpixel((15, 5)) == (0, 255, 0, 255)
    assert merged.getpixel((19, 9)) == (0, 255, 0, 255)
    info = json.loads((archives_dir / result["folder"] / "info.json").read_text(encoding="utf-8"))
    assert info["sources"] == ["page/split/01.png", "page/colored/big.png"]
    assert info["settings"] == {"panels": {"02.png": "page/colored/big.png"}}


def test_merge_reports_missing_override() -> None:
    _make_split_folder("split/")
    with pytest.raises(merge_service.MergeServiceError, match=r"コマ画像 \(page/gone.png\)"):
        merge_service.merge_panels("page/split", {"01.png": "page/gone.png"})


@pytest.mark.parametrize("text", ["{", "[]", '{"01.png": 3}'])
def test_parse_overrides_rejects_bad_input(text: str) -> None:
    with pytest.raises(merge_service.MergeServiceError):
        merge_service.parse_overrides(text)


def test_parse_overrides() -> None:
    assert merge_service.parse_overrides(None) == {}
    assert merge_service.parse_overrides('{"01.png": "a/b.png"}') == {"01.png": "a/b.png"}
