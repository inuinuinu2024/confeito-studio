"""Manga panel splitting (コマ分割): detect panels with Gemini, crop them, save to an archive.

Output (see docs/specs/tools/panel-split-merge.md): ``01.png, 02.png, ..., panels.json, info.json`` in
``<root archive>/<YYYYMMDD_HHMMSS>_コマ分割/``, or a new archive of that name without ``target_folder``
(``archive_service.save_result``).

A panel can be cut again from the page with a box chosen by hand (コマ切り直し, ``recrop_panel``): a result
``<archive>/<YYYYMMDD_HHMMSS>_コマ切り直し/<panel file name>`` whose source is the panel, so every re-cut of a
panel is one more version of it (docs/specs/flow-canvas.md 「コマの切り直し」).

A panel the detection missed can be added by hand (コマ追加, ``add_panel``): a result
``<archive>/<YYYYMMDD_HHMMSS>_コマ追加/panel.png`` whose source is the コマ分割 folder; ``settings.after`` /
``settings.before`` are the panels it was put between (docs/specs/flow-canvas.md 「コマの追加」). panels.json is
never rewritten.
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
from .archive_service import (
    RESULT_INFO_FILE,
    ArchiveServiceError,
    extract_file,
    normalize_rel_path,
    save_result,
    split_archive_path,
)

TOOL_NAME = "コマ分割"
RECROP_TOOL_NAME = "コマ切り直し"
ADD_TOOL_NAME = "コマ追加"
ADDED_PANEL_FILE = "panel.png"


class PanelServiceError(BadRequestError):
    pass


def build_preview(
    reading_order: str, model_name: str, thinking_level: str, prompt: str | None = None
) -> dict[str, Any]:
    """The Gemini request ``split_panels`` would send (image data replaced by a placeholder)."""
    model = geo.normalize_model_name(model_name)
    request_body = geo.build_detection_request(
        "<BASE64_IMAGE_DATA>", reading_order, geo.normalize_thinking_level(thinking_level), instructions=prompt
    )
    return {
        "api_endpoint": f"{gemini.API_BASE_URL}/models/{model}:generateContent",
        "request_body": request_body,
    }


def detect_panels(
    image: Image.Image,
    reading_order: str,
    model: str,
    thinking_level: str,
    api_key: str,
    instructions: str | None = None,
) -> list[dict[str, Any]]:
    """Calls Gemini and returns the raw ``[{"panel_number", "box_2d"}, ...]`` list."""
    image_b64 = base64.b64encode(geo.prepare_inference_image(image)).decode("utf-8")
    payload = geo.build_detection_request(image_b64, reading_order, thinking_level, instructions=instructions)
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
    prompt: str | None = None,
) -> dict[str, Any]:
    """``target_folder``: the selected archive folder (its top level gets the result folder).
    ``source_key``: ARCHIVES key of the split image, recorded in info.json.
    ``prompt``: the detection instructions (blank: the defaults), recorded in info.json as used."""
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

    instructions = prompt.strip() if prompt and prompt.strip() else geo.DEFAULT_DETECTION_INSTRUCTIONS
    boxes = geo.order_by_markers(detect_panels(image, reading_order, model, level, key, instructions))
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
    settings = {
        "model": model,
        "thinking_level": level,
        "reading_order": reading_order,
        "padding": padding,
        "prompt": instructions,
    }
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


def parse_box(text: str | None) -> list[float]:
    """The ``box`` form field of /recrop-panel: JSON ``[xmin, ymin, xmax, ymax]`` in pixels of the page."""
    try:
        data = json.loads(text or "")
    except ValueError as e:
        raise PanelServiceError("切り出す範囲を JSON として読めません。", raw_response=exception_text(e)) from e
    if not isinstance(data, list) or len(data) != 4:
        raise PanelServiceError("切り出す範囲の指定が正しくありません。", raw_response=text)
    return data


def _read_json(archive: str, path: str) -> dict[str, Any] | None:
    try:
        content, _ = extract_file(archive, path)
        data = json.loads(content.decode("utf-8"))
    except (ArchiveServiceError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _split_page(split_info: dict[str, Any], action: str) -> Image.Image:
    """The page a コマ分割 split (its info.json ``source``), loaded. ``action``: what needs it (for the message)."""
    page_key = split_info.get("source")
    if not isinstance(page_key, str) or not page_key:
        raise PanelServiceError(f"分割前のページが記録されていないため、{action}。")
    try:
        content, _ = extract_file(*split_archive_path(page_key))
        page = Image.open(io.BytesIO(content))
        page.load()
    except ArchiveServiceError as e:
        raise PanelServiceError(f"分割前のページ（{page_key}）が見つかりません。", raw_response=e.message) from e
    except Exception as e:
        raise PanelServiceError("分割前のページを読み込めませんでした。", raw_response=exception_text(e)) from e
    return page


def _crop_box(page: Image.Image, box: list[float]) -> tuple[int, int, int, int]:
    pixel_box = geo.clamp_pixel_box(box, *page.size)
    if pixel_box is None:
        raise PanelServiceError("切り出す範囲がページの外か、大きさが 0 です。", raw_response=json.dumps(box))
    return pixel_box


def _cut_result(folder: str, filename: str, pixel_box: tuple[int, int, int, int]) -> dict[str, Any]:
    xmin, ymin, xmax, ymax = pixel_box
    return {
        "status": "success",
        "folder": folder,
        "key": f"{folder}/{filename}",
        "pixel_box": list(pixel_box),
        "width": xmax - xmin,
        "height": ymax - ymin,
    }


def _info_of_folder(folder: str) -> dict[str, Any] | None:
    archive, path = split_archive_path(folder)
    return _read_json(archive, f"{path}/{RESULT_INFO_FILE}" if path else RESULT_INFO_FILE)


def recrop_panel(panel_key: str, box: list[float]) -> dict[str, Any]:
    """Cuts panel ``panel_key`` (an output of a コマ分割, or a panel added by hand) again from the split page with
    ``box`` (``[xmin, ymin, xmax, ymax]`` in page pixels) and saves it as a コマ切り直し result of the panel."""
    key = normalize_rel_path(panel_key or "")
    archive, path = split_archive_path(key)
    folder_path, _, filename = path.rpartition("/")
    if not archive or not filename:
        raise PanelServiceError("切り出し直すコマが指定されていません。")
    prefix = f"{folder_path}/" if folder_path else ""

    info = _read_json(archive, f"{prefix}{RESULT_INFO_FILE}") or {}
    if info.get("tool") == TOOL_NAME:
        split_folder = f"{archive}/{folder_path}" if folder_path else archive
        split_info = info
        panels_meta = _read_json(archive, f"{prefix}panels.json") or {}
        panels = panels_meta.get("panels") if isinstance(panels_meta.get("panels"), list) else []
        if not any(isinstance(p, dict) and p.get("filename") == filename for p in panels):
            raise PanelServiceError(f"コマ分割の panels.json に「{filename}」がありません。")
    elif info.get("tool") == ADD_TOOL_NAME and isinstance(info.get("source"), str):
        # A panel added by hand: cut from the page of the コマ分割 it was added to.
        split_folder = normalize_rel_path(info["source"])
        split_info = _info_of_folder(split_folder) or {}
        if split_info.get("tool") != TOOL_NAME:
            raise PanelServiceError(f"追加したコマのコマ分割（{split_folder}）が見つかりません。")
    else:
        raise PanelServiceError(f"「{filename}」はコマ分割の結果のコマではありません。")
    page = _split_page(split_info, "切り出し直せません")
    pixel_box = _crop_box(page, box)

    now = datetime.now()
    folder = save_result(
        archive,
        f"{now:%Y%m%d_%H%M%S}_{RECROP_TOOL_NAME}",
        [(filename, geo.to_png_bytes(page.crop(pixel_box)))],
        {
            "tool": RECROP_TOOL_NAME,
            "source": key,
            "settings": {"split": split_folder, "panel": filename, "pixel_box": list(pixel_box)},
        },
        now,
    )
    return _cut_result(folder, filename, pixel_box)


def add_panel(
    split_folder: str, box: list[float], after: str | None = None, before: str | None = None
) -> dict[str, Any]:
    """Cuts a new panel of the コマ分割 ``split_folder`` from its page with ``box`` and saves it as a コマ追加 result.
    ``after`` / ``before``: keys of the panels it goes between (None at the top / the bottom)."""
    split = normalize_rel_path(split_folder or "")
    archive, _ = split_archive_path(split)
    if not archive:
        raise PanelServiceError("コマを追加するコマ分割が指定されていません。")
    info = _info_of_folder(split)
    if not info or info.get("tool") != TOOL_NAME:
        raise PanelServiceError(f"「{split}」はコマ分割の結果ではありません。")
    page = _split_page(info, "コマを追加できません")
    pixel_box = _crop_box(page, box)

    now = datetime.now()
    folder = save_result(
        archive,
        f"{now:%Y%m%d_%H%M%S}_{ADD_TOOL_NAME}",
        [(ADDED_PANEL_FILE, geo.to_png_bytes(page.crop(pixel_box)))],
        {
            "tool": ADD_TOOL_NAME,
            "source": split,
            "settings": {
                "split": split,
                "pixel_box": list(pixel_box),
                "after": normalize_rel_path(after) if after else None,
                "before": normalize_rel_path(before) if before else None,
            },
        },
        now,
    )
    return _cut_result(folder, ADDED_PANEL_FILE, pixel_box)
