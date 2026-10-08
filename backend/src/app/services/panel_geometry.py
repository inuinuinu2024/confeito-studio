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
    "right_to_left": "Japanese manga reading order (top-to-bottom, right-to-left)",
    "left_to_right": "Western comic reading order (top-to-bottom, left-to-right)",
}

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


def build_detection_prompt(reading_order: str) -> str:
    """Prompt for panel detection. Keep in sync with the JSON preview in panel-splitter.ts."""
    order_desc = READING_ORDER_DESCRIPTIONS.get(reading_order, READING_ORDER_DESCRIPTIONS["left_to_right"])
    return f"""You are an expert manga / comic panel detector.
Analyze this manga page and detect every individual panel (frame / コマ).
Return one bounding box per panel.

Panel number marks (highest priority when present):
- Some pages carry small hand-written numbers added by the author or editor to indicate the panel order
  (often in pencil or a different color from the artwork, in a corner of a panel or in the gutter / margin next to it, sometimes circled).
- If such marks exist, use them as the primary guide for splitting and ordering: each mark identifies exactly one panel,
  namely the panel it is written in or the panel it is closest to. Put that number in "marker_number".
- Carefully distinguish marks from numbers that belong to the artwork or the text. These are NOT marks:
  numbers inside speech bubbles, narration boxes or sound effects; numbers on signs, clocks, screens, clothing, jerseys or objects;
  page numbers (nombre); any number drawn in the same style as the artwork.
- Genuine marks form a consecutive sequence starting at 1, appear at most once per panel, and share the same hand-written style.
  If you are not sure a number is a mark, do not treat it as one.
- Panels without a mark must still be detected; set their "marker_number" to null. If the page has no marks, set it to null for every panel.

Panel boundaries:
- Borders may be faint, partly missing or not drawn at all (borderless panels, panels bleeding off the page edge).
  Infer each panel's extent from the composition, the gutters and the arrangement of the scenes.
- Speech bubbles, sound effects, decorations or background art that cross a boundary or fill the gutter do NOT join panels
  and do NOT enlarge a box. Split at where the panel boundary should be, even if that cuts through them.
- When a panel is placed inside another panel (inset) or panels overlap, return the full extent of the outer panel AND
  the full extent of the inner / overlapping panel as separate panels. Never shrink a box to avoid another panel.
- Each box covers the panel's frame including its border line. Do not extend a box to include a number mark outside the frame.

Order:
- If the page has marks, order the panels by their mark numbers.
- Otherwise, order the panels strictly in {order_desc}.
- Panels without a mark go where they fall in that reading order.

Output a JSON array of objects with the following schema:
[
  {{
    "panel_number": 1,
    "box_2d": [ymin, xmin, ymax, xmax],
    "marker_number": 1
  }}
]

Important constraints:
- Coordinates [ymin, xmin, ymax, xmax] MUST be normalized integers from 0 to 1000 relative to the image height and width.
  ymin=0 is top, ymax=1000 is bottom. xmin=0 is left, xmax=1000 is right.
- Return ONLY valid JSON, with no markdown fences, no conversational text.
"""  # noqa: E501


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
    image_b64: str, reading_order: str, thinking_level: str, mime_type: str = "image/jpeg"
) -> dict[str, Any]:
    """Request body for ``models/{model}:generateContent``."""
    return {
        "contents": [
            {
                "parts": [
                    {"text": build_detection_prompt(reading_order)},
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
