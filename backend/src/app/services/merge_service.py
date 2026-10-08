"""Panel merging (コマ結合): paste split panels back onto a canvas of the original size.

Reads ``panels.json`` written by panel_service and saves ``<YYYYMMDD_HHMMSS>_コマ結合.png`` + info.json
in ``<root of the target>/<YYYYMMDD_HHMMSS>_コマ結合/`` (``archive_service.save_result``).
A panel can be replaced by another image (e.g. its colored version, docs/specs/tools/panel-split-merge.md):
``overrides`` maps the panel's file name to an archive key, and that image is resized to the panel's size.
A panel cut again from the page (コマ切り直し) has its own box: ``boxes`` maps the panel's file name to that
``[xmin, ymin, xmax, ymax]``, and the image is pasted there at that size instead.
"""

import io
import json
from datetime import datetime
from typing import Any

from PIL import Image

from ..errors import BadRequestError, exception_text
from .archive_service import ArchiveServiceError, extract_file, normalize_rel_path, save_result, split_archive_path
from .panel_geometry import clamp_pixel_box

TOOL_NAME = "コマ結合"


class MergeServiceError(BadRequestError):
    pass


def _load_panels_json(root: str, folder_path: str, label: str) -> dict[str, Any]:
    path = f"{folder_path}/panels.json" if folder_path else "panels.json"
    try:
        content, _ = extract_file(root, path)
        return json.loads(content.decode("utf-8"))
    except ArchiveServiceError as e:
        raise MergeServiceError(
            f"選択されたフォルダ ({label}) 内に panels.json が見つかりません。"
            "コマ分割ツールで作成されたフォルダを選択してください。"
        ) from e
    except json.JSONDecodeError as e:
        raise MergeServiceError(
            f"フォルダ ({label}) 内の panels.json の解析に失敗しました。ファイルが破損している可能性があります。"
        ) from e


def parse_overrides(text: str | None) -> dict[str, str]:
    """The ``overrides`` form field of /merge-panels (JSON object: panel file name -> archive key)."""
    if not text:
        return {}
    try:
        data = json.loads(text)
    except ValueError as e:
        raise MergeServiceError("差し替えるコマの指定を JSON として読めません。", raw_response=exception_text(e)) from e
    if not isinstance(data, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in data.items()):
        raise MergeServiceError("差し替えるコマの指定が正しくありません。", raw_response=text)
    return data


def parse_boxes(text: str | None) -> dict[str, list[float]]:
    """The ``boxes`` form field of /merge-panels (JSON object: panel file name -> [xmin, ymin, xmax, ymax])."""
    if not text:
        return {}
    try:
        data = json.loads(text)
    except ValueError as e:
        raise MergeServiceError("切り直したコマの範囲を JSON として読めません。", raw_response=exception_text(e)) from e
    valid = isinstance(data, dict) and all(
        isinstance(k, str) and isinstance(v, list) and len(v) == 4 for k, v in data.items()
    )
    if not valid:
        raise MergeServiceError("切り直したコマの範囲の指定が正しくありません。", raw_response=text)
    return data


def _open_image(archive: str, path: str, label: str) -> Image.Image:
    try:
        img_bytes, _ = extract_file(archive, path)
        return Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    except ArchiveServiceError as e:
        raise MergeServiceError(
            f"コマ画像 ({label}) がフォルダ内に見つかりません。ファイルが削除または移動された可能性があります。"
        ) from e
    except Exception as e:
        raise MergeServiceError(f"コマ画像 ({label}) を読み込めませんでした。", raw_response=exception_text(e)) from e


def _compose(
    root: str,
    folder_path: str,
    panels_data: dict[str, Any],
    overrides: dict[str, str],
    boxes: dict[str, list[float]],
) -> tuple[bytes, list[str]]:
    """The merged PNG and the key of every image pasted (in panel order)."""
    width = panels_data.get("image_size", {}).get("width")
    height = panels_data.get("image_size", {}).get("height")
    panels = panels_data.get("panels", [])
    if not width or not height:
        raise MergeServiceError("panels.json に画像サイズが含まれていません。")
    if not panels:
        raise MergeServiceError("panels.json にコマ情報が含まれていません。")

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    used: list[str] = []
    pieces: list[tuple[Image.Image, int, int]] = []
    for panel in panels:
        filename = panel.get("filename")
        if not filename:
            continue
        panel_path = f"{folder_path}/{filename}" if folder_path else filename
        panel_img = _open_image(root, panel_path, filename)
        x, y = 0, 0
        if "pixel_box" in panel:
            x, y = panel["pixel_box"][:2]
        elif "xywh" in panel:
            x, y = panel["xywh"][:2]
        size = panel_img.size
        if filename in boxes:
            box = clamp_pixel_box(boxes[filename], width, height)
            if box is None:
                raise MergeServiceError(f"切り直したコマ ({filename}) の範囲が結合後の画像の外か、大きさが 0 です。")
            x, y, size = box[0], box[1], (box[2] - box[0], box[3] - box[1])

        used_key = f"{root}/{panel_path}"
        if filename in overrides:
            used_key = normalize_rel_path(overrides[filename])
            archive, path = split_archive_path(used_key)
            panel_img = _open_image(archive, path, used_key)
        if panel_img.size != size:
            panel_img = panel_img.resize(size, Image.Resampling.LANCZOS)
        used.append(used_key)
        pieces.append((panel_img, int(x), int(y)))

    # Larger panels first, so inset / overlapping smaller panels end up on top (stable for equal sizes).
    for panel_img, x, y in sorted(pieces, key=lambda p: p[0].width * p[0].height, reverse=True):
        canvas.paste(panel_img, (x, y), panel_img)

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue(), used


def _settings(overrides: dict[str, str], boxes: dict[str, list[float]]) -> dict[str, Any]:
    """info.json settings: the replaced panels and the boxes of the panels cut again (each only when any)."""
    settings: dict[str, Any] = {}
    if overrides:
        settings["panels"] = overrides
    if boxes:
        settings["boxes"] = boxes
    return settings


def merge_panels(
    target_folder: str, overrides: dict[str, str] | None = None, boxes: dict[str, list[float]] | None = None
) -> dict[str, Any]:
    target = normalize_rel_path(target_folder)
    if not target:
        raise MergeServiceError(
            "対象のコマ分割が指定されていません。キャンバスでコマ分割の結果（コマ）を選択してください。"
        )

    parts = target.split("/")
    root, folder_path = parts[0], "/".join(parts[1:])
    panels_data = _load_panels_json(root, folder_path, target)
    overrides = overrides or {}
    boxes = boxes or {}
    merged, used = _compose(root, folder_path, panels_data, overrides, boxes)

    now = datetime.now()
    name = f"{now:%Y%m%d_%H%M%S}_{TOOL_NAME}"
    out_filename = f"{name}.png"
    folder = save_result(
        root,
        name,
        [(out_filename, merged)],
        {"tool": TOOL_NAME, "source": target, "sources": used, "settings": _settings(overrides, boxes)},
        now,
    )

    return {
        "status": "success",
        "folder": folder,
        "filename": out_filename,
        "auto_select_key": f"{folder}/{out_filename}",
    }
