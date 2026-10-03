"""Panel merging (コマ結合): paste split panels back onto a canvas of the original size.

Reads ``panels.json`` written by panel_service and saves ``<YYYYMMDD_HHMMSS>_コマ結合.png`` + info.json
in ``<root of the target>/<YYYYMMDD_HHMMSS>_コマ結合/`` (``archive_service.save_result``).
"""

import io
import json
from datetime import datetime
from typing import Any

from PIL import Image

from ..errors import BadRequestError, exception_text
from .archive_service import ArchiveServiceError, extract_file, normalize_rel_path, save_result

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


def _compose(root: str, folder_path: str, panels_data: dict[str, Any]) -> bytes:
    width = panels_data.get("image_size", {}).get("width")
    height = panels_data.get("image_size", {}).get("height")
    panels = panels_data.get("panels", [])
    if not width or not height:
        raise MergeServiceError("panels.json に画像サイズが含まれていません。")
    if not panels:
        raise MergeServiceError("panels.json にコマ情報が含まれていません。")

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for panel in panels:
        filename = panel.get("filename")
        if not filename:
            continue
        try:
            img_bytes, _ = extract_file(root, f"{folder_path}/{filename}" if folder_path else filename)
            panel_img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
        except ArchiveServiceError as e:
            raise MergeServiceError(
                f"コマ画像 ({filename}) がフォルダ内に見つかりません。ファイルが削除または移動された可能性があります。"
            ) from e
        except Exception as e:
            raise MergeServiceError(
                f"コマ画像 ({filename}) を読み込めませんでした。", raw_response=exception_text(e)
            ) from e

        x, y = 0, 0
        if "pixel_box" in panel:
            x, y = panel["pixel_box"][:2]
        elif "xywh" in panel:
            x, y = panel["xywh"][:2]
        canvas.paste(panel_img, (int(x), int(y)), panel_img)

    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()


def merge_panels(target_folder: str) -> dict[str, Any]:
    target = normalize_rel_path(target_folder)
    if not target:
        raise MergeServiceError(
            "対象フォルダが指定されていません。ARCHIVESリストから対象のフォルダを選択してください。"
        )

    parts = target.split("/")
    root, folder_path = parts[0], "/".join(parts[1:])
    panels_data = _load_panels_json(root, folder_path, target)
    merged = _compose(root, folder_path, panels_data)

    now = datetime.now()
    name = f"{now:%Y%m%d_%H%M%S}_{TOOL_NAME}"
    out_filename = f"{name}.png"
    folder = save_result(
        root, name, [(out_filename, merged)], {"tool": TOOL_NAME, "source": target, "settings": {}}, now
    )

    return {
        "status": "success",
        "folder": folder,
        "filename": out_filename,
        "auto_select_key": f"{folder}/{out_filename}",
    }
