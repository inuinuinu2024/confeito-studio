"""Pure helpers for manga panel splitting (no I/O; unit tested in tests/test_panel_geometry.py).

Coordinate systems:
  * ``box_2d``    Gemini normalized box ``[ymin, xmin, ymax, xmax]`` in 0..1000
  * ``pixel_box`` Pillow / PASCAL VOC ``[xmin, ymin, xmax, ymax]`` in pixels of the original image
  * ``xywh``      COCO / OpenCV ``[xmin, ymin, width, height]``
"""

import io
import json
import math
import re
from typing import Any

from PIL import Image

DEFAULT_MODEL = "gemini-3.8-flash"
MODEL_ALIASES = {
    "gemini-3.1-pro": "gemini-3.1-pro-preview",
    "gemini-3-pro": "gemini-3.1-pro-preview",
    "gemini-3.8-flash": "gemini-3.8-flash",
}
THINKING_LEVELS = ("LOW", "MEDIUM", "HIGH")
MAX_INFERENCE_EDGE = 4096
"""Images are downscaled to this long edge before upload (Gemini's ~20MB request limit)."""

READING_ORDER_DESCRIPTIONS = {
    "right_to_left": "日本の漫画の読み順（上から下、右から左）",
    "left_to_right": "西洋のコミックの読み順（上から下、左から右）",
}
"""What ``{reading_order}`` of the detection instructions becomes (Japanese, as the default instructions)."""

PANEL_RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "panel_number": {"type": "INTEGER"},
            "box_2d": {"type": "ARRAY", "items": {"type": "INTEGER"}},
            "marker_number": {"type": "INTEGER", "nullable": True},
        },
        "required": ["panel_number", "box_2d"],
    },
}


def normalize_model_name(model_name: str | None) -> str:
    raw = (model_name or DEFAULT_MODEL).strip()
    return MODEL_ALIASES.get(raw.lower(), raw)


def normalize_thinking_level(thinking_level: str | None) -> str:
    return thinking_level.upper() if thinking_level else "LOW"


READING_ORDER_PLACEHOLDER = "{reading_order}"
"""Where the detection instructions take the reading order (``READING_ORDER_DESCRIPTIONS``) of the settings."""

DEFAULT_DETECTION_INSTRUCTIONS = """あなたは漫画のコマ割りを検出する専門家です。
この漫画のページを分析し、すべてのコマ（枠）を検出してください。
コマ 1 つにつき 1 つのバウンディングボックスを返してください。

コマ番号の目印（ある場合は最優先）:
- 作者や編集者が、コマの順番を示すために小さな手書きの数字を書き足していることがあります
  （鉛筆や絵と違う色で、コマの隅や、すぐ横のコマ間・ページの余白に書かれ、丸で囲まれていることもあります）。
- そのような目印がある場合は、コマの分け方と順番の第一の手がかりにしてください。目印 1 つはちょうど 1 つのコマ、
  つまりその目印が書かれているコマ、またはいちばん近いコマを示します。その番号を "marker_number" に入れてください。
- 目印と、絵や文字の一部である数字を注意して見分けてください。次のものは目印ではありません:
  吹き出し・ナレーション・効果音の中の数字、看板・時計・画面・服・ゼッケン・物に描かれた数字、
  ノンブル（ページ番号）、絵と同じタッチで描かれた数字。
- 本物の目印は 1 から始まる連番で、1 つのコマに多くても 1 つで、同じ手書きの書き方でそろっています。
  目印かどうか迷う数字は、目印として扱わないでください。
- 目印のないコマも必ず検出し、"marker_number" を null にしてください。ページに目印がない場合は、すべてのコマで null にしてください。

コマの境界:
- 枠線は薄い・一部が途切れている・まったく描かれていない（枠のないコマ、ページの端まで裁ち切りのコマ）ことがあります。
  構図・コマ間の余白・場面の並びから、それぞれのコマの範囲を推定してください。
- 吹き出し・効果音・装飾・背景が境界をまたいだり、コマ間の余白を埋めていたりしても、コマをつなげたり、ボックスを広げたりしないでください。
  それらを切ることになっても、本来のコマの境界で分けてください。
- コマの中に別のコマが置かれている（入れ子）場合や、コマが重なっている場合は、外側のコマの全体と、内側・重なっている側のコマの全体を、
  それぞれ別のコマとして返してください。ほかのコマを避けるためにボックスを縮めないでください。
- 各ボックスは枠線を含むコマの範囲にしてください。枠の外にある番号の目印を含めるためにボックスを広げないでください。

順番:
- ページに目印がある場合は、目印の番号順にコマを並べてください。
- 目印がない場合は、厳密に {reading_order} でコマを並べてください。
- 目印のないコマは、その読み順で入る位置に置いてください。"""  # noqa: E501
"""The detection instructions the user can edit (docs/specs/tools/panel-split-merge.md 「プロンプト」); the output format
(``DETECTION_OUTPUT_FORMAT``) always follows them."""

DETECTION_OUTPUT_FORMAT = """Output a JSON array of objects with the following schema:
[
  {
    "panel_number": 1,
    "box_2d": [ymin, xmin, ymax, xmax],
    "marker_number": 1
  }
]

Important constraints:
- Coordinates [ymin, xmin, ymax, xmax] MUST be normalized integers from 0 to 1000 relative to the image height and width.
  ymin=0 is top, ymax=1000 is bottom. xmin=0 is left, xmax=1000 is right.
- Return ONLY valid JSON, with no markdown fences, no conversational text.
"""
"""What ``parse_panel_response`` reads: fixed, not editable (a broken format cannot be parsed)."""


def build_detection_prompt(reading_order: str, instructions: str | None = None) -> str:
    """Prompt for panel detection: ``instructions`` (the defaults when blank) with the reading order put in, then
    the fixed output format."""
    order_desc = READING_ORDER_DESCRIPTIONS.get(reading_order, READING_ORDER_DESCRIPTIONS["left_to_right"])
    text = instructions.strip() if instructions and instructions.strip() else DEFAULT_DETECTION_INSTRUCTIONS
    return f"{text.replace(READING_ORDER_PLACEHOLDER, order_desc)}\n\n{DETECTION_OUTPUT_FORMAT}"


def build_generation_config(thinking_level: str) -> dict[str, Any]:
    config: dict[str, Any] = {
        "response_mime_type": "application/json",
        "temperature": 0.1,
        "response_schema": PANEL_RESPONSE_SCHEMA,
    }
    if thinking_level in THINKING_LEVELS:
        config["thinkingConfig"] = {"thinkingLevel": thinking_level}
    return config


FALLBACK_GENERATION_CONFIG = {"response_mime_type": "application/json", "temperature": 0.1}
"""Used when the model rejects thinkingConfig / response_schema (HTTP 400)."""


def build_detection_request(
    image_b64: str,
    reading_order: str,
    thinking_level: str,
    mime_type: str = "image/jpeg",
    instructions: str | None = None,
) -> dict[str, Any]:
    """Request body for ``models/{model}:generateContent`` (``instructions``: see ``build_detection_prompt``)."""
    return {
        "contents": [
            {
                "parts": [
                    {"text": build_detection_prompt(reading_order, instructions)},
                    {"inline_data": {"mime_type": mime_type, "data": image_b64}},
                ],
            }
        ],
        "generationConfig": build_generation_config(thinking_level),
    }


def prepare_inference_image(image: Image.Image) -> bytes:
    """JPEG (quality 85) for upload, downscaled to MAX_INFERENCE_EDGE. Cropping uses the original."""
    width, height = image.size
    inference = image
    if width > MAX_INFERENCE_EDGE or height > MAX_INFERENCE_EDGE:
        ratio = MAX_INFERENCE_EDGE / float(max(width, height))
        inference = image.resize((int(width * ratio), int(height * ratio)), Image.Resampling.LANCZOS)
    if inference.mode in ("RGBA", "P"):
        inference = inference.convert("RGB")
    buf = io.BytesIO()
    inference.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def extract_response_text(response_json: dict[str, Any]) -> str:
    """Text of the last non-thought part of the first candidate (thinking models emit thought parts)."""
    candidates = response_json.get("candidates", [])
    if not candidates:
        return ""
    parts = candidates[0].get("content", {}).get("parts", [])
    target = next((p for p in reversed(parts) if not p.get("thought", False) and "text" in p), None)
    if target is None and parts:
        target = parts[-1]
    text = (target.get("text", "") if target else "").strip()
    text = re.sub(r"^```json\s*", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s*```$", "", text)


def parse_panel_boxes(text: str) -> list[dict[str, Any]]:
    """Parses the model output into ``[{"panel_number", "box_2d"}, ...]`` (raises ValueError)."""
    parsed = json.loads(text)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict) and "panels" in parsed:
        return parsed["panels"]
    return []


def _marker(box: dict[str, Any]) -> int | None:
    value = box.get("marker_number") if isinstance(box, dict) else None
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def order_by_markers(boxes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sorts the panels carrying a hand-written number mark by that number, keeping them in the slots
    they occupied; unmarked panels stay where the model put them (in reading order). Stable."""
    slots = [i for i, box in enumerate(boxes) if _marker(box) is not None]
    if len(slots) < 2:
        return list(boxes)
    marked = sorted((boxes[i] for i in slots), key=lambda box: _marker(box) or 0)
    ordered = list(boxes)
    for slot, box in zip(slots, marked, strict=True):
        ordered[slot] = box
    return ordered


def to_pixel_box(box_2d: list[float], width: int, height: int, padding: int = 0) -> tuple[int, int, int, int] | None:
    """Converts a normalized ``box_2d`` to a clamped ``(xmin, ymin, xmax, ymax)``; None if empty."""
    ymin, xmin, ymax, xmax = (float(c) for c in box_2d)
    px_ymin = int(round((ymin / 1000.0) * height))
    px_xmin = int(round((xmin / 1000.0) * width))
    px_ymax = int(round((ymax / 1000.0) * height))
    px_xmax = int(round((xmax / 1000.0) * width))

    if padding > 0:
        px_ymin = max(0, px_ymin - padding)
        px_xmin = max(0, px_xmin - padding)
        px_ymax = min(height, px_ymax + padding)
        px_xmax = min(width, px_xmax + padding)

    if px_xmax <= px_xmin or px_ymax <= px_ymin:
        return None

    px_xmin = max(0, min(width - 1, px_xmin))
    px_ymin = max(0, min(height - 1, px_ymin))
    px_xmax = max(px_xmin + 1, min(width, px_xmax))
    px_ymax = max(px_ymin + 1, min(height, px_ymax))
    return px_xmin, px_ymin, px_xmax, px_ymax


def clamp_pixel_box(box: Any, width: int, height: int) -> tuple[int, int, int, int] | None:
    """A ``[xmin, ymin, xmax, ymax]`` pixel box (e.g. chosen by hand) rounded and clamped to the image;
    None when it is not four finite numbers or nothing is left of it."""
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return None
    if not all(isinstance(c, (int, float)) and not isinstance(c, bool) and math.isfinite(c) for c in box):
        return None
    xmin, ymin, xmax, ymax = (int(round(c)) for c in box)
    xmin, ymin = max(0, xmin), max(0, ymin)
    xmax, ymax = min(width, xmax), min(height, ymax)
    if xmax <= xmin or ymax <= ymin:
        return None
    return xmin, ymin, xmax, ymax


def panel_record(index: int, box_2d: list[float], pixel_box: tuple[int, int, int, int]) -> dict[str, Any]:
    """One entry of ``panels.json["panels"]``."""
    xmin, ymin, xmax, ymax = pixel_box
    return {
        "panel_number": index,
        "filename": panel_filename(index),
        "box_2d": [int(float(c)) for c in box_2d],
        "pixel_box": [xmin, ymin, xmax, ymax],
        "xywh": [xmin, ymin, xmax - xmin, ymax - ymin],
        "width": xmax - xmin,
        "height": ymax - ymin,
    }


def panel_filename(index: int) -> str:
    return f"{index:02d}.png"


def to_png_bytes(image: Image.Image) -> bytes:
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA")
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()
