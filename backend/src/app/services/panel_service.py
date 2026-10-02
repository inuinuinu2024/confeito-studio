"""Manga panel splitting (コマ分割): detect panels with Gemini, crop them, save to an archive.

Output (see docs/specs/tools/panel-split-merge.md):
  * ``target_folder`` given  -> ``<root archive>/<YYYYMMDD_HHMMSS>_コマ分割/{01.png,...,panels.json}``
  * no ``target_folder``     -> new archive ``<YYYYMMDD_HHMMSS>_コマ分割/{01.png,...,panels.json}``
  * one line is appended to ``<root archive>/log.txt``
"""

import base64
import io
import json
from datetime import datetime
from typing import Any

import requests
from PIL import Image

from ..errors import BadRequestError
from ..providers import gemini
from . import panel_geometry as geo
from .archive_service import ArchiveServiceError, append_archive_log, save_archive, split_archive_path


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
            gemini.raise_for_status(resp, label="Gemini API エラー")
        except gemini.GeminiAPIError as e:
            raise PanelServiceError(e.message) from e

        response_json = resp.json()
        if not response_json.get("candidates"):
            raise PanelServiceError("Gemini API から応答が返されませんでした。")
        raw_text = geo.extract_response_text(response_json)
        return geo.parse_panel_boxes(raw_text)
    except json.JSONDecodeError as e:
        raise PanelServiceError(f"GeminiからのJSON応答の解析に失敗しました: {e}\nレスポンス: {raw_text}") from e
    except requests.exceptions.RequestException as e:
        raise PanelServiceError(f"Gemini API への通信に失敗しました: {e}") from e


def split_panels(
    image_bytes: bytes,
    original_filename: str = "image.png",
    reading_order: str = "left_to_right",
    padding: int = 0,
    api_key: str | None = None,
    model_name: str = geo.DEFAULT_MODEL,
    thinking_level: str = "LOW",
    target_folder: str | None = None,
) -> dict[str, Any]:
    key = gemini.resolve_api_key(api_key)
    if not key:
        raise PanelServiceError("GEMINI_API_KEY が設定されていません。.env または設定画面をご確認ください。")
    model = geo.normalize_model_name(model_name)
    level = geo.normalize_thinking_level(thinking_level)

    try:
        image = Image.open(io.BytesIO(image_bytes))
        width, height = image.size
    except Exception as e:
        raise PanelServiceError(f"画像ファイルの読み込みに失敗しました: {e}") from e

    boxes = detect_panels(image, reading_order, model, level, key)
    if not boxes:
        boxes = [{"panel_number": 1, "box_2d": [0, 0, 1000, 1000]}]  # treat the page as one panel

    now = datetime.now()
    sub_folder = f"{now:%Y%m%d_%H%M%S}_コマ分割"
    target_root, _ = split_archive_path((target_folder or "").strip())
    if target_root:
        root_archive, prefix = target_root, f"{sub_folder}/"
    else:
        root_archive, prefix = sub_folder, ""

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
        files.append((f"{prefix}{geo.panel_filename(index)}", geo.to_png_bytes(image.crop(pixel_box))))
        panels.append(geo.panel_record(index, box_2d, pixel_box))

    if not panels:
        raise PanelServiceError("有効なコマを検出・切り分けることができませんでした。")

    created_at = now.strftime("%Y-%m-%d %H:%M:%S")
    panels_meta = {
        "version": "1.0",
        "timestamp": now.isoformat(),
        "created_at": created_at,
        "original_filename": original_filename,
        "image_size": {"width": width, "height": height},
        "reading_order": reading_order,
        "model": model,
        "thinking_level": level,
        "padding": padding,
        "panels_count": len(panels),
        "panels": panels,
    }
    files.append((f"{prefix}panels.json", json.dumps(panels_meta, ensure_ascii=False, indent=2).encode("utf-8")))

    try:
        save_archive(root_archive, files)
        sub_folder_label = sub_folder if target_root else "なし"
        append_archive_log(
            root_archive,
            f"[{created_at}] コマ分割ツールを実行し、{len(panels)}コマに分割しました"
            f"（元ファイル名 {original_filename}、サブフォルダ名: {sub_folder_label}）",
        )
    except ArchiveServiceError as e:
        raise PanelServiceError(f"アーカイブの保存に失敗しました: {e}") from e

    return {
        "status": "success",
        "archive_name": root_archive,
        "sub_folder": sub_folder if target_root else None,
        "folder_name": root_archive,
        "auto_select_key": f"{root_archive}/{prefix}{geo.panel_filename(1)}",
        "panels_count": len(panels),
        "panels": panels,
        "original_filename": original_filename,
        "image_width": width,
        "image_height": height,
        "model": model,
        "thinking_level": level,
    }
