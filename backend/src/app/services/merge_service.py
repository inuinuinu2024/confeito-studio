"""Panel merging (コマ結合): paste split panels back onto a canvas of the original size.

Reads ``panels.json`` written by panel_service. Output location:
  * target is a sub-folder ``root/a/b`` -> ``root/a/<YYYYMMDD_HHMMSS>_コマ結合.png`` (its parent)
  * target is a root archive ``root``   -> new archive ``<YYYYMMDD_HHMMSS>_コマ結合/``
A log line is appended to the original root archive's ``log.txt`` (best effort).
"""

import io
import json
from datetime import datetime
from typing import Any

from PIL import Image

from ..errors import BadRequestError
from .archive_service import (
    ArchiveServiceError,
    append_archive_log,
    extract_file,
    normalize_rel_path,
    save_archive,
)


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
            raise MergeServiceError(f"コマ画像 ({filename}) の読み込みに失敗しました: {e}") from e

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
    out_filename = f"{now:%Y%m%d_%H%M%S}_コマ結合.png"
    if len(parts) > 1:
        dest_archive = root
        parent_path = "/".join(parts[1:-1])
        out_path = f"{parent_path}/{out_filename}" if parent_path else out_filename
    else:
        dest_archive = f"{now:%Y%m%d_%H%M%S}_コマ結合"
        out_path = out_filename

    try:
        save_archive(dest_archive, [(out_path, merged)])
    except Exception as e:
        raise MergeServiceError(f"結合画像の保存に失敗しました: {e}") from e

    try:
        append_archive_log(
            root,
            f"[{now:%Y-%m-%d %H:%M:%S}] コマ結合ツールを実行し、{len(panels_data['panels'])}個のコマを結合しました"
            f"（対象フォルダ: {target}、保存ファイル: {out_filename}）",
        )
    except ArchiveServiceError:
        pass  # the log is informational only

    return {
        "status": "success",
        "parent_folder": dest_archive,
        "filename": out_filename,
        "auto_select_key": f"{dest_archive}/{out_path}",
    }
