import io

import pytest
from PIL import Image

from src.app.services import panel_geometry as geo


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        (None, "gemini-3.8-flash"),
        ("", "gemini-3.8-flash"),
        (" Gemini-3.1-Pro ", "gemini-3.1-pro-preview"),
        ("gemini-3-pro", "gemini-3.1-pro-preview"),
        ("Custom-Model", "Custom-Model"),
    ],
)
def test_normalize_model_name(given: str | None, expected: str) -> None:
    assert geo.normalize_model_name(given) == expected


def test_to_pixel_box_scales_normalized_coordinates() -> None:
    # box_2d is [ymin, xmin, ymax, xmax] in 0..1000; result is (xmin, ymin, xmax, ymax)
    assert geo.to_pixel_box([0, 0, 500, 250], width=400, height=200) == (0, 0, 100, 100)


def test_to_pixel_box_applies_padding_and_clamps() -> None:
    assert geo.to_pixel_box([100, 100, 900, 900], width=1000, height=1000, padding=50) == (50, 50, 950, 950)
    assert geo.to_pixel_box([0, 0, 1000, 1000], width=100, height=100, padding=30) == (0, 0, 100, 100)


def test_to_pixel_box_rejects_empty_boxes() -> None:
    assert geo.to_pixel_box([500, 500, 500, 600], width=100, height=100) is None


def test_panel_record_contains_all_coordinate_formats() -> None:
    record = geo.panel_record(3, [10.6, 20, 30, 40], (5, 6, 15, 26))
    assert record == {
        "panel_number": 3,
        "filename": "03.png",
        "box_2d": [10, 20, 30, 40],
        "pixel_box": [5, 6, 15, 26],
        "xywh": [5, 6, 10, 20],
        "width": 10,
        "height": 20,
    }


def test_extract_response_text_skips_thoughts_and_fences() -> None:
    response = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"text": "final answer", "thought": False},
                        {"text": "thinking...", "thought": True},
                    ]
                }
            }
        ]
    }
    assert geo.extract_response_text(response) == "final answer"
    fenced = {"candidates": [{"content": {"parts": [{"text": '```json\n[{"a": 1}]\n```'}]}}]}
    assert geo.extract_response_text(fenced) == '[{"a": 1}]'
    assert geo.extract_response_text({}) == ""


def test_parse_panel_boxes_accepts_list_or_panels_key() -> None:
    assert geo.parse_panel_boxes('[{"box_2d": [0, 0, 1, 1]}]') == [{"box_2d": [0, 0, 1, 1]}]
    assert geo.parse_panel_boxes('{"panels": [{"box_2d": []}]}') == [{"box_2d": []}]
    assert geo.parse_panel_boxes('{"other": 1}') == []
    with pytest.raises(ValueError):
        geo.parse_panel_boxes("not json")


def _boxes(*markers: object) -> list[dict[str, object]]:
    return [{"id": i, "marker_number": m} for i, m in enumerate(markers)]


def _ids(boxes: list[dict[str, object]]) -> list[object]:
    return [b["id"] for b in boxes]


def test_order_by_markers_sorts_marked_panels() -> None:
    assert _ids(geo.order_by_markers(_boxes(3, 1, 2))) == [1, 2, 0]


def test_order_by_markers_keeps_unmarked_panels_in_place() -> None:
    # Unmarked panels (ids 1, 3) keep their reading-order slots; marked ones are sorted into the others.
    assert _ids(geo.order_by_markers(_boxes(3, None, 1, None, 2))) == [2, 1, 4, 3, 0]


def test_order_by_markers_without_usable_markers_keeps_model_order() -> None:
    assert _ids(geo.order_by_markers(_boxes(None, None))) == [0, 1]
    assert _ids(geo.order_by_markers(_boxes(5, None))) == [0, 1]
    assert _ids(geo.order_by_markers([{"id": 0}, {"id": 1}])) == [0, 1]


def test_order_by_markers_ignores_invalid_values_and_is_stable() -> None:
    assert _ids(geo.order_by_markers(_boxes(2, 0, "1", True, 1))) == [4, 1, 2, 3, 0]
    assert _ids(geo.order_by_markers(_boxes(2, 1, 2, 1))) == [1, 3, 0, 2]


def test_detection_request_includes_thinking_config_only_for_known_levels() -> None:
    body = geo.build_detection_request("B64", "right_to_left", "HIGH")
    config = body["generationConfig"]
    assert config["thinkingConfig"] == {"thinkingLevel": "HIGH"}
    assert config["response_schema"] == geo.PANEL_RESPONSE_SCHEMA
    assert config["response_schema"]["items"]["properties"]["marker_number"] == {"type": "INTEGER", "nullable": True}
    text = body["contents"][0]["parts"][0]["text"]
    assert "Japanese manga reading order" in text
    assert "hand-written numbers" in text and "NOT marks" in text
    assert "inside another panel" in text
    assert "without cutting off dialogue bubbles" not in text
    assert body["contents"][0]["parts"][1] == {"inline_data": {"mime_type": "image/jpeg", "data": "B64"}}
    assert "thinkingConfig" not in geo.build_detection_request("B64", "left_to_right", "WHATEVER")["generationConfig"]


def test_prepare_inference_image_downscales_and_converts_to_jpeg() -> None:
    big = Image.new("RGBA", (8192, 1024), (0, 0, 0, 0))
    jpeg = geo.prepare_inference_image(big)
    out = Image.open(io.BytesIO(jpeg))
    assert out.format == "JPEG"
    assert out.size == (4096, 512)


def test_clamp_pixel_box_rounds_and_clamps_to_the_image() -> None:
    assert geo.clamp_pixel_box([10.4, 20.6, 50, 60], width=100, height=100) == (10, 21, 50, 60)
    assert geo.clamp_pixel_box([-5, -5, 120, 130], width=100, height=80) == (0, 0, 100, 80)


@pytest.mark.parametrize(
    "box",
    [None, [0, 0, 10], [0, 0, 10, "x"], [0, 0, True, 10], [10, 10, 10, 20], [200, 0, 300, 10], [0, 0, float("nan"), 5]],
)
def test_clamp_pixel_box_rejects_bad_or_empty_boxes(box: object) -> None:
    assert geo.clamp_pixel_box(box, width=100, height=100) is None
