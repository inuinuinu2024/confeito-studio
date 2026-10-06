import io
import json
from pathlib import Path

import pytest
from PIL import Image

from src.app.services import archive_service, flow_service
from src.app.services.archive_service import save_archive, save_result

from .conftest import make_png


def _info(tool: str, source: str | None, outputs: list[str], created_at: str) -> bytes:
    return json.dumps(
        {"tool": tool, "created_at": created_at, "source": source, "settings": {"k": 1}, "outputs": outputs}
    ).encode()


def test_flow_lists_roots_and_runs_oldest_first() -> None:
    save_archive(
        "page",
        [
            ("page.png", make_png(40, 20)),
            ("notes.txt", b"x"),
            ("20260102_000000_split/02.png", make_png(5, 5)),
            ("20260102_000000_split/01.png", make_png(6, 6)),
            ("20260102_000000_split/panels.json", b"{}"),
            (
                "20260102_000000_split/info.json",
                _info("コマ分割", "page/page.png", ["01.png", "02.png", "panels.json"], "2026-01-02 00:00:00"),
            ),
            ("20260101_000000_nobg/nobg.png", make_png(40, 20)),
            ("20260101_000000_nobg/Raw/raw.png", make_png(1, 1)),
            (
                "20260101_000000_nobg/info.json",
                _info("背景除去", "page/page.png", ["nobg.png", "Raw/raw.png"], "2026-01-01 00:00:00"),
            ),
            ("empty_folder/readme.txt", b"no images"),
        ],
    )

    flow = flow_service.get_flow("page")

    assert flow["archive"] == "page"
    assert flow["roots"] == [{"key": "page/page.png", "name": "page.png", "width": 40, "height": 20}]
    assert [r["folder"] for r in flow["runs"]] == ["page/20260101_000000_nobg", "page/20260102_000000_split"]
    nobg, split = flow["runs"]
    assert nobg["tool"] == "背景除去" and nobg["source"] == "page/page.png" and nobg["settings"] == {"k": 1}
    # Only images directly in the result folder become outputs (Raw/ and json are left out).
    assert [o["key"] for o in nobg["outputs"]] == ["page/20260101_000000_nobg/nobg.png"]
    # The order of info.json outputs is kept.
    assert [o["name"] for o in split["outputs"]] == ["01.png", "02.png"]
    assert split["outputs"][0]["width"] == 6
    assert flow["selection"] == {} and flow["merge"] == {}


def test_folder_without_readable_info_is_a_run_without_input() -> None:
    save_archive(
        "page",
        [
            ("20260101_120000_背景除去_2/b.png", make_png(2, 2)),
            ("20260101_120000_背景除去_2/a.png", make_png(2, 2)),
            ("20260101_120000_背景除去_2/info.json", b"{broken"),
        ],
    )

    (run,) = flow_service.get_flow("page")["runs"]

    assert run["tool"] == "背景除去"
    assert run["source"] is None and run["sources"] == []
    assert [o["name"] for o in run["outputs"]] == ["a.png", "b.png"]
    assert run["created_at"]


def test_sources_are_read_from_info(archives_dir: Path) -> None:
    save_archive("page", [("page.png", make_png(4, 4))])
    folder = save_result(
        "page",
        "20260101_000000_コマ結合",
        [("m.png", make_png(4, 4))],
        {"tool": "コマ結合", "source": "page/split", "sources": ["page/a.png", "page/b.png"], "settings": {}},
    )

    run = next(r for r in flow_service.get_flow("page")["runs"] if r["folder"] == folder)

    assert run["sources"] == ["page/a.png", "page/b.png"]


def test_selection_is_saved_in_the_archive_and_hidden_from_contents(archives_dir: Path) -> None:
    save_archive("page", [("page.png", make_png(4, 4))])

    flow_service.set_selection("page", "page/page.png|背景除去", "page/run_2")
    flow_service.set_selection("page", "other", "page/run_3")
    flow_service.set_selection("page", "other", None)

    assert flow_service.get_flow("page")["selection"] == {"page/page.png|背景除去": "page/run_2"}
    assert (archives_dir / "page" / ".flow.json").is_file()
    assert [e["name"] for e in archive_service.list_archive_contents("page")] == ["page.png"]


def test_merge_choices_are_kept_next_to_the_selection() -> None:
    save_archive("page", [("page.png", make_png(4, 4))])

    flow_service.set_selection("page", "s", "f")
    flow_service.set_merge_choice("page", "page/split/01.png", "page/gen/g.png")
    flow_service.set_merge_choice("page", "page/split/02.png", "page/x.png")
    flow_service.set_merge_choice("page", "page/split/02.png", None)

    flow = flow_service.get_flow("page")
    assert flow["merge"] == {"page/split/01.png": "page/gen/g.png"}
    assert flow["selection"] == {"s": "f"}
    with pytest.raises(archive_service.ArchiveValidationError):
        flow_service.set_merge_choice("page", "", "x")


def test_broken_flow_file_counts_as_no_selection(archives_dir: Path) -> None:
    save_archive("page", [("page.png", make_png(4, 4)), (".flow.json", b"[1, 2")])

    assert flow_service.get_flow("page")["selection"] == {}
    flow_service.set_selection("page", "s", "f")
    assert flow_service.get_flow("page")["selection"] == {"s": "f"}


def test_missing_archive_raises_not_found() -> None:
    with pytest.raises(archive_service.ArchiveNotFoundError):
        flow_service.get_flow("missing")


@pytest.mark.parametrize(
    ("color", "mime"), [((255, 0, 0, 128), "image/png"), ((255, 0, 0, 255), "image/png"), (None, "image/jpeg")]
)
def test_thumbnail_keeps_alpha_and_limits_size(color: tuple[int, int, int, int] | None, mime: str) -> None:
    if color is None:
        buf = io.BytesIO()
        Image.new("RGB", (800, 400), (0, 255, 0)).save(buf, format="JPEG")
        data, name = buf.getvalue(), "big.jpg"
    else:
        data, name = make_png(800, 400, color), "big.png"
    save_archive("page", [(name, data)])

    content, mime_type = flow_service.thumbnail("page", name, 200)

    assert mime_type == mime
    assert Image.open(io.BytesIO(content)).size == (200, 100)


def test_thumbnail_rejects_missing_and_non_images() -> None:
    save_archive("page", [("info.json", b"{}")])
    with pytest.raises(archive_service.ArchiveNotFoundError):
        flow_service.thumbnail("page", "info.json", 100)
    with pytest.raises(archive_service.ArchiveNotFoundError):
        flow_service.thumbnail("page", "nothing.png", 100)


def test_flow_api(client) -> None:
    save_archive("page", [("page.png", make_png(300, 100))])

    flow = client.get("/api/archives/page/flow").json()
    assert flow["roots"][0]["key"] == "page/page.png"

    assert client.put("/api/archives/page/flow/selection", json={"stack": "s", "folder": "f"}).status_code == 200
    assert client.get("/api/archives/page/flow").json()["selection"] == {"s": "f"}
    assert client.put("/api/archives/page/flow/merge", json={"panel": "p", "image": "i"}).status_code == 200
    assert client.get("/api/archives/page/flow").json()["merge"] == {"p": "i"}

    res = client.get("/api/archives/page/thumbnail", params={"path": "page.png", "size": 150})
    assert res.status_code == 200
    assert Image.open(io.BytesIO(res.content)).size == (150, 50)
    assert res.headers["cache-control"] == "no-store"

    assert client.get("/api/archives/page/thumbnail", params={"path": "x.png"}).status_code == 404
