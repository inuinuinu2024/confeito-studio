import io
import json
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from src.app.providers import gemini
from src.app.services import panel_service
from src.app.services.archive_service import save_archive

from .conftest import make_png


class FakeResponse:
    def __init__(self, status_code: int, body: Any) -> None:
        self.status_code = status_code
        self._body = body
        self.text = body if isinstance(body, str) else json.dumps(body)

    def json(self) -> Any:
        return json.loads(self.text)


def gemini_reply(boxes: list[dict[str, Any]]) -> FakeResponse:
    return FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": json.dumps(boxes)}]}}]})


class FakeGemini:
    """Stands in for ``gemini.generate_content``: pops queued ``responses`` and records ``calls``."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.responses: list[FakeResponse] = []

    def __call__(self, model: str, payload: dict[str, Any], api_key: str) -> FakeResponse:
        self.calls.append({"model": model, "payload": payload, "api_key": api_key})
        return self.responses.pop(0)


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeGemini:
    fake_gemini = FakeGemini()
    monkeypatch.setattr(gemini, "generate_content", fake_gemini)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    return fake_gemini


def test_missing_api_key_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(panel_service.PanelServiceError, match="Gemini API Key が設定されていません"):
        panel_service.split_panels(make_png(10, 10))


def test_split_into_subfolder_of_selected_archive(fake: FakeGemini, archives_dir: Path) -> None:
    (archives_dir / "page").mkdir()
    (archives_dir / "page" / "log.txt").write_text("[init]\n", encoding="utf-8")
    fake.responses.append(
        gemini_reply(
            [
                {"panel_number": 1, "box_2d": [0, 0, 500, 1000]},
                {"panel_number": 2, "box_2d": [500, 0, 1000, 1000]},
            ]
        )
    )

    result = panel_service.split_panels(
        make_png(200, 100),
        original_filename="page.png",
        target_folder="page/sub",
        model_name="gemini-3.1-pro",
        thinking_level="high",
        source_key="page/page.png",
    )

    assert fake.calls[0]["model"] == "gemini-3.1-pro-preview"
    assert fake.calls[0]["api_key"] == "test-key"
    assert fake.calls[0]["payload"]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "HIGH"}
    folder = result["folder"]
    assert folder.startswith("page/") and folder.endswith("_コマ分割")  # top level, even with a sub folder selected
    assert result["auto_select_key"] == f"{folder}/01.png"
    assert result["panels_count"] == 2
    files = {p.name for p in (archives_dir / folder).iterdir()}
    assert files == {"01.png", "02.png", "panels.json", "info.json"}

    meta = json.loads((archives_dir / folder / "panels.json").read_text(encoding="utf-8"))
    assert meta["image_size"] == {"width": 200, "height": 100}
    assert [p["pixel_box"] for p in meta["panels"]] == [[0, 0, 200, 50], [0, 50, 200, 100]]
    info = json.loads((archives_dir / folder / "info.json").read_text(encoding="utf-8"))
    assert info["tool"] == "コマ分割" and info["source"] == "page/page.png"
    assert info["settings"] == {
        "model": "gemini-3.1-pro-preview",
        "thinking_level": "HIGH",
        "reading_order": "left_to_right",
        "padding": 0,
    }
    assert info["outputs"] == ["01.png", "02.png", "panels.json"]

    # No log is written (docs/specs/notifications.md): the existing log.txt stays as it was.
    assert (archives_dir / "page" / "log.txt").read_text(encoding="utf-8") == "[init]\n"


def test_split_without_target_creates_new_archive(fake: FakeGemini, archives_dir: Path) -> None:
    fake.responses.append(gemini_reply([]))  # no panels -> whole page becomes one panel

    result = panel_service.split_panels(make_png(30, 20))

    root = result["folder"]
    assert "/" not in root and root.endswith("_コマ分割")
    assert result["auto_select_key"] == f"{root}/01.png"
    assert {p.name for p in (archives_dir / root).iterdir()} == {"01.png", "panels.json", "info.json"}
    assert json.loads((archives_dir / root / "info.json").read_text(encoding="utf-8"))["source"] is None


def test_panels_are_numbered_by_hand_written_markers(fake: FakeGemini, archives_dir: Path) -> None:
    fake.responses.append(
        gemini_reply(
            [
                {"panel_number": 1, "box_2d": [0, 0, 500, 1000], "marker_number": 2},
                {"panel_number": 2, "box_2d": [0, 0, 1000, 1000], "marker_number": None},
                {"panel_number": 3, "box_2d": [500, 0, 1000, 1000], "marker_number": 1},
            ]
        )
    )

    result = panel_service.split_panels(make_png(100, 100))

    meta = json.loads((archives_dir / result["folder"] / "panels.json").read_text(encoding="utf-8"))
    assert [p["pixel_box"] for p in meta["panels"]] == [[0, 50, 100, 100], [0, 0, 100, 100], [0, 0, 100, 50]]
    assert [p["filename"] for p in meta["panels"]] == ["01.png", "02.png", "03.png"]
    assert all("marker_number" not in p for p in meta["panels"])


def test_retries_without_thinking_config_when_model_rejects_it(fake: FakeGemini) -> None:
    fake.responses.extend(
        [
            FakeResponse(400, {"error": {"message": "thinking is not supported"}}),
            gemini_reply([{"box_2d": [0, 0, 1000, 1000]}]),
        ]
    )

    panel_service.split_panels(make_png(10, 10))

    assert len(fake.calls) == 2
    assert fake.calls[1]["payload"]["generationConfig"] == {
        "response_mime_type": "application/json",
        "temperature": 0.1,
    }


def test_api_error_keeps_gemini_response_as_raw(fake: FakeGemini) -> None:
    fake.responses.append(FakeResponse(500, {"error": {"message": "boom"}}))
    with pytest.raises(panel_service.PanelServiceError) as info:
        panel_service.split_panels(make_png(10, 10))
    assert info.value.message == "Gemini API がエラーを返しました（HTTP 500）。"
    assert info.value.raw_response == {"error": {"message": "boom"}}


def test_unparseable_model_output(fake: FakeGemini) -> None:
    fake.responses.append(FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}))
    with pytest.raises(panel_service.PanelServiceError) as info:
        panel_service.split_panels(make_png(10, 10))
    assert info.value.message == "Gemini の応答（JSON）を解析できませんでした。"
    assert info.value.raw_response.startswith("JSONDecodeError: ")
    assert info.value.raw_response.endswith("\nnot json")


def test_preview_matches_request_shape() -> None:
    preview = panel_service.build_preview("right_to_left", "gemini-3.1-pro", "MEDIUM")
    assert preview["api_endpoint"].endswith("/models/gemini-3.1-pro-preview:generateContent")
    body = preview["request_body"]
    assert body["contents"][0]["parts"][1]["inline_data"]["data"] == "<BASE64_IMAGE_DATA>"
    assert body["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "MEDIUM"}


def _split_fixture(info_source: str | None = "page/page.png") -> None:
    """A 200x100 page (left half red, right half blue) and a コマ分割 result of it with two panels."""
    page = Image.new("RGBA", (200, 100), (255, 0, 0, 255))
    page.paste((0, 0, 255, 255), (100, 0, 200, 100))
    buf = io.BytesIO()
    page.save(buf, format="PNG")
    panels = {
        "image_size": {"width": 200, "height": 100},
        "panels": [
            {"filename": "01.png", "pixel_box": [0, 0, 100, 100]},
            {"filename": "02.png", "pixel_box": [100, 0, 200, 100]},
        ],
    }
    info = {"tool": "コマ分割", "source": info_source, "settings": {}, "outputs": ["01.png", "02.png"]}
    save_archive(
        "page",
        [
            ("page.png", buf.getvalue()),
            ("split/01.png", make_png(100, 100)),
            ("split/02.png", make_png(100, 100, (0, 0, 255, 255))),
            ("split/panels.json", json.dumps(panels).encode()),
            ("split/info.json", json.dumps(info).encode()),
        ],
    )


def test_recrop_panel_cuts_the_page_again_as_a_version_of_the_panel(archives_dir: Path) -> None:
    _split_fixture()

    result = panel_service.recrop_panel("page/split/01.png", [50.2, 10, 150, 90])

    folder = result["folder"]
    assert folder.startswith("page/") and folder.endswith("_コマ切り直し")
    assert result["key"] == f"{folder}/01.png"
    assert result["pixel_box"] == [50, 10, 150, 90]
    assert (result["width"], result["height"]) == (100, 80)
    cut = Image.open(archives_dir / result["key"])
    assert cut.size == (100, 80)
    assert cut.getpixel((10, 10)) == (255, 0, 0, 255)  # from the red half of the page
    assert cut.getpixel((90, 10)) == (0, 0, 255, 255)  # from the blue half
    info = json.loads((archives_dir / folder / "info.json").read_text(encoding="utf-8"))
    assert info["tool"] == "コマ切り直し" and info["source"] == "page/split/01.png"
    assert info["settings"] == {"split": "page/split", "panel": "01.png", "pixel_box": [50, 10, 150, 90]}
    assert info["outputs"] == ["01.png"]


@pytest.mark.parametrize(
    ("panel", "box", "source", "message"),
    [
        ("", [0, 0, 10, 10], "page/page.png", "切り出し直すコマが指定されていません"),
        ("page/page.png", [0, 0, 10, 10], "page/page.png", "コマ分割の結果のコマではありません"),
        ("page/split/03.png", [0, 0, 10, 10], "page/page.png", "panels.json に「03.png」がありません"),
        ("page/split/01.png", [0, 0, 10, 10], None, "分割前のページが記録されていない"),
        ("page/split/01.png", [0, 0, 10, 10], "page/gone.png", r"分割前のページ（page/gone.png）が見つかりません"),
        ("page/split/01.png", [300, 0, 400, 10], "page/page.png", "ページの外か、大きさが 0"),
    ],
)
def test_recrop_panel_errors(panel: str, box: list[float], source: str | None, message: str) -> None:
    _split_fixture(source)
    with pytest.raises(panel_service.PanelServiceError, match=message):
        panel_service.recrop_panel(panel, box)


@pytest.mark.parametrize("text", [None, "{", "[1, 2, 3]", '{"a": 1}'])
def test_parse_box_rejects_bad_input(text: str | None) -> None:
    with pytest.raises(panel_service.PanelServiceError):
        panel_service.parse_box(text)
