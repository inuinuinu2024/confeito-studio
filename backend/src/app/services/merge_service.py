import json
import io
from datetime import datetime
from typing import Dict, Any
from PIL import Image

from .archive_service import extract_file, save_archive, _safe_resolve, ArchiveServiceError

class MergeServiceError(Exception):
    pass

def merge_panels(target_folder: str) -> Dict[str, Any]:
    """
    指定されたフォルダ内の panels.json を読み込み、各コマ画像を元の用紙サイズで結合します。
    """
    clean_target = target_folder.replace("\\", "/").strip("/")
    if not clean_target:
        raise MergeServiceError("対象フォルダが指定されていません。ARCHIVESリストから対象のフォルダを選択してください。")
    
    parts = clean_target.split("/")
    root_archive = parts[0]
    subfolder_path = "/".join(parts[1:]) if len(parts) > 1 else ""
    
    panels_json_path = f"{subfolder_path}/panels.json" if subfolder_path else "panels.json"
    
    try:
        panels_json_bytes, _ = extract_file(root_archive, panels_json_path)
        panels_data = json.loads(panels_json_bytes.decode("utf-8"))
    except ArchiveServiceError:
        raise MergeServiceError(f"選択されたフォルダ ({clean_target}) 内に panels.json が見つかりません。コマ分割ツールで作成されたフォルダを選択してください。")
    except json.JSONDecodeError:
        raise MergeServiceError(f"フォルダ ({clean_target}) 内の panels.json の解析に失敗しました。ファイルが破損している可能性があります。")
        
    width = panels_data.get("image_size", {}).get("width")
    height = panels_data.get("image_size", {}).get("height")
    panels = panels_data.get("panels", [])
    
    if not width or not height:
        raise MergeServiceError("panels.json に画像サイズが含まれていません。")
        
    if not panels:
        raise MergeServiceError("panels.json にコマ情報が含まれていません。")
        
    # Create a transparent base image
    base_image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    
    for panel in panels:
        filename = panel.get("filename")
        if not filename:
            continue
            
        try:
            panel_path = f"{subfolder_path}/{filename}" if subfolder_path else filename
            img_bytes, _ = extract_file(root_archive, panel_path)
            panel_img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
        except ArchiveServiceError:
            raise MergeServiceError(f"コマ画像 ({filename}) がフォルダ内に見つかりません。ファイルが削除または移動された可能性があります。")
        except Exception as e:
            raise MergeServiceError(f"コマ画像 ({filename}) の読み込みに失敗しました: {str(e)}")
            
        px_xmin, px_ymin = 0, 0
        if "pixel_box" in panel:
            px_xmin, px_ymin, _, _ = panel["pixel_box"]
        elif "xywh" in panel:
            px_xmin, px_ymin, _, _ = panel["xywh"]
            
        # Paste the panel onto the base image
        base_image.paste(panel_img, (int(px_xmin), int(px_ymin)), panel_img)
        
    # Convert base_image to bytes
    bio = io.BytesIO()
    base_image.save(bio, format="PNG")
    merged_bytes = bio.getvalue()
    
    # Determine save path
    now = datetime.now()
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    out_filename = f"{timestamp}_コマ結合.png"
    
    # parts already extracted at the beginning
    original_root = root_archive
    
    # If target is a subfolder (e.g. A/B), parent is A/
    if len(parts) > 1:
        root_archive = original_root
        parent_path = "/".join(parts[1:-1])
        prefix = f"{parent_path}/" if parent_path else ""
        out_path = f"{prefix}{out_filename}"
        auto_select_key = f"{root_archive}/{out_path}"
    else:
        # If target is root archive, create a new archive folder
        root_archive = f"{timestamp}_コマ結合"
        out_path = out_filename
        auto_select_key = f"{root_archive}/{out_path}"
        
    archive_files = [(out_path, merged_bytes)]
    
    # Append log to the original root archive
    formatted_date = now.strftime("%Y-%m-%d %H:%M:%S")
    log_line = f"[{formatted_date}] コマ結合ツールを実行し、{len(panels)}個のコマを結合しました（対象フォルダ: {clean_target}、保存ファイル: {out_filename}）\n"
    
    try:
        root_log_file = _safe_resolve(original_root, "log.txt")
        if root_log_file.exists() and root_log_file.is_file():
            prev_content = root_log_file.read_text(encoding="utf-8")
            updated_log = prev_content.rstrip() + "\n" + log_line
        else:
            updated_log = log_line
        
        # If saving to the same root archive, append to archive_files
        if root_archive == original_root:
            archive_files.append(("log.txt", updated_log.encode("utf-8")))
        else:
            # If saving to a new root archive, save the log in the original root archive directly
            root_log_file.write_text(updated_log, encoding="utf-8")
    except Exception:
        pass
        
    try:
        save_archive(root_archive, archive_files)
    except Exception as e:
        raise MergeServiceError(f"結合画像の保存に失敗しました: {str(e)}")
        
    return {
        "status": "success",
        "parent_folder": root_archive,
        "filename": out_filename,
        "auto_select_key": auto_select_key,
    }
