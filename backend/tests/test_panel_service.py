import json
from pathlib import Path
from typing import Any

import pytest

from src.app.providers import gemini
from src.app.services import panel_service

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
    with pytest.raises(panel_service.PanelServiceError, match="GEMINI_API_KEY が設定されていません"):
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
    )

    assert fake.calls[0]["model"] == "gemini-3.1-pro-preview"
    assert fake.calls[0]["api_key"] == "test-key"
    assert fake.calls[0]["payload"]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "HIGH"}
    sub = result["sub_folder"]
    assert result["archive_name"] == "page" and sub.endswith("_コマ分割")
    assert result["auto_select_key"] == f"page/{sub}/01.png"
    assert result["panels_count"] == 2
    assert {p.name for p in (archives_dir / "page" / sub).iterdir()} == {"01.png", "02.png", "panels.json"}

    meta = json.loads((archives_dir / "page" / sub / "panels.json").read_text(encoding="utf-8"))
    assert meta["image_size"] == {"width": 200, "height": 100}
    assert [p["pixel_box"] for p in meta["panels"]] == [[0, 0, 200, 50], [0, 50, 200, 100]]

    log = (archives_dir / "page" / "log.txt").read_text(encoding="utf-8").splitlines()
    assert log[0] == "[init]"
    assert "コマ分割ツールを実行し、2コマに分割しました（元ファイル名 page.png、サブフォルダ名: " in log[1]


def test_split_without_target_creates_new_archive(fake: FakeGemini, archives_dir: Path) -> None:
    fake.responses.append(gemini_reply([]))  # no panels -> whole page becomes one panel

    result = panel_service.split_panels(make_png(30, 20))

    assert result["sub_folder"] is None
    root = result["archive_name"]
    assert result["auto_select_key"] == f"{root}/01.png"
    assert {p.name for p in (archives_dir / root).iterdir()} == {"01.png", "panels.json", "log.txt"}
    assert "サブフォルダ名: なし" in (archives_dir / root / "log.txt").read_text(encoding="utf-8")


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


def test_api_error_message(fake: FakeGemini) -> None:
    fake.responses.append(FakeResponse(500, {"error": {"message": "boom"}}))
    with pytest.raises(panel_service.PanelServiceError, match=r"^Gemini API エラー \(500\): boom$"):
        panel_service.split_panels(make_png(10, 10))


def test_unparseable_model_output(fake: FakeGemini) -> None:
    fake.responses.append(FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}))
    with pytest.raises(panel_service.PanelServiceError, match="JSON応答の解析に失敗しました"):
        panel_service.split_panels(make_png(10, 10))


def test_preview_matches_request_shape() -> None:
    preview = panel_service.build_preview("right_to_left", "gemini-3.1-pro", "MEDIUM")
    assert preview["api_endpoint"].endswith("/models/gemini-3.1-pro-preview:generateContent")
    body = preview["request_body"]
    assert body["contents"][0]["parts"][1]["inline_data"]["data"] == "<BASE64_IMAGE_DATA>"
    assert body["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "MEDIUM"}
