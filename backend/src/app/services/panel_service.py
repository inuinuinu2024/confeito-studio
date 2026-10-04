"""Manga panel splitting (コマ分割): detect panels with Gemini, crop them, save to an archive.

Output (see docs/specs/tools/panel-split-merge.md): ``01.png, 02.png, ..., panels.json, info.json`` in
``<root archive>/<YYYYMMDD_HHMMSS>_コマ分割/``, or a new archive of that name without ``target_folder``
(``archive_service.save_result``).
"""

import base64
import io
import json
from datetime import datetime
from typing import Any

import requests
from PIL import Image

from ..errors import BadRequestError, exception_text
from ..providers import gemini
from . import panel_geometry as geo
from . import usage_service
from .archive_service import save_result

TOOL_NAME = "コマ分割"


class PanelServiceError(BadRequestError):
    pass


def build_preview(reading_order: str, model_name: str, thinking_level: str) -> dict[str, Any]:
    """The Gemini request ``split_panels`` would send (image data replaced by a placeholder)."""
    model = geo.normalize_model_name(model_name)
    request_body = geo.build_detection_request(
        "<BASE64_IMAGE_DATA>", reading_order, geo.normalize_thinking_level(thinking_level)
    )
    return {
        "api_endpoint": f"{gemini.API_BASE_URL}/models/{model}:generateContent",
        "request_body": request_body,
    }


def detect_panels(
    image: Image.Image, reading_order: str, model: str, thinking_level: str, api_key: str
) -> list[dict[str, Any]]:
    """Calls Gemini and returns the raw ``[{"panel_number", "box_2d"}, ...]`` list."""
    image_b64 = base64.b64encode(geo.prepare_inference_image(image)).decode("utf-8")
    payload = geo.build_detection_request(image_b64, reading_order, thinking_level)
    raw_text = ""
    try:
        resp = gemini.generate_content(model, payload, api_key)
        lowered = resp.text.lower()
        if resp.status_code == 400 and ("thinking" in lowered or "schema" in lowered):
            # Older models reject thinkingConfig / response_schema: retry with a plain config.
            payload = {**payload, "generationConfig": geo.FALLBACK_GENERATION_CONFIG}
            resp = gemini.generate_content(model, payload, api_key)
        try:
            gemini.raise_for_status(resp)
        except gemini.GeminiAPIError as e:
            raise PanelServiceError(e.message, raw_response=e.raw_response) from e

        response_json = resp.json()
        usage_service.record_response(
            tool=TOOL_NAME,
            model=model,
            api="generate_content",
            service_tier=None,
            status="success" if response_json.get("candidates") else "no_output",
            response=response_json,
        )
        if not response_json.get("candidates"):
            raise PanelServiceError("Gemini API から応答が返されませんでした。", raw_response=response_json)
        raw_text = geo.extract_response_text(response_json)
        return geo.parse_panel_boxes(raw_text)
    except json.JSONDecodeError as e:
        raise PanelServiceError(
            "Gemini の応答（JSON）を解析できませんでした。", raw_response=f"{exception_text(e)}\n{raw_text}"
        ) from e
    except requests.exceptions.RequestException as e:
        raise PanelServiceError("Gemini API に接続できませんでした。", raw_response=exception_text(e)) from e


def split_panels(
    image_bytes: bytes,
    original_filename: str = "image.png",
    reading_order: str = "left_to_right",
    padding: int = 0,
    api_key: str | None = None,
    model_name: str = geo.DEFAULT_MODEL,
    thinking_level: str = "LOW",
    target_folder: str | None = None,
    source_key: str | None = None,
) -> dict[str, Any]:
    """``target_folder``: the selected archive folder (its top level gets the result folder).
    ``source_key``: ARCHIVES key of the split image, recorded in info.json."""
    key = gemini.resolve_api_key(api_key)
    if not key:
        raise PanelServiceError(gemini.MISSING_API_KEY_MESSAGE)
    model = geo.normalize_model_name(model_name)
    level = geo.normalize_thinking_level(thinking_level)

    try:
        image = Image.open(io.BytesIO(image_bytes))
        width, height = image.size
    except Exception as e:
        raise PanelServiceError("画像ファイルを読み込めませんでした。", raw_response=exception_text(e)) from e

    boxes = detect_panels(image, reading_order, model, level, key)
    if not boxes:
        boxes = [{"panel_number": 1, "box_2d": [0, 0, 1000, 1000]}]  # treat the page as one panel

    files: list[tuple[str, bytes]] = []
    panels: list[dict[str, Any]] = []
    for item in boxes:
        box_2d = item.get("box_2d")
        if not box_2d or len(box_2d) != 4:
            continue
        pixel_box = geo.to_pixel_box(box_2d, width, height, padding)
        if pixel_box is None:
            continue
        index = len(panels) + 1
        files.append((geo.panel_filename(index), geo.to_png_bytes(image.crop(pixel_box))))
        panels.append(geo.panel_record(index, box_2d, pixel_box))

    if not panels:
        raise PanelServiceError("有効なコマを検出・切り分けることができませんでした。")

    now = datetime.now()
    panels_meta = {
        "version": "1.0",
        "timestamp": now.isoformat(),
        "created_at": f"{now:%Y-%m-%d %H:%M:%S}",
        "original_filename": original_filename,
        "image_size": {"width": width, "height": height},
        "reading_order": reading_order,
        "model": model,
        "thinking_level": level,
        "padding": padding,
        "panels_count": len(panels),
        "panels": panels,
    }
    files.append(("panels.json", json.dumps(panels_meta, ensure_ascii=False, indent=2).encode("utf-8")))
    settings = {"model": model, "thinking_level": level, "reading_order": reading_order, "padding": padding}
    folder = save_result(
        target_folder,
        f"{now:%Y%m%d_%H%M%S}_{TOOL_NAME}",
        files,
        {"tool": TOOL_NAME, "source": source_key or None, "settings": settings},
        now,
    )

    return {
        "status": "success",
        "folder": folder,
        "auto_select_key": f"{folder}/{geo.panel_filename(1)}",
        "panels_count": len(panels),
        "panels": panels,
        "original_filename": original_filename,
        "image_width": width,
        "image_height": height,
        "model": model,
        "thinking_level": level,
    }
