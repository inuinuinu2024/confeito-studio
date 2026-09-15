import os
import io
import re
import json
import base64
import requests
from datetime import datetime
from typing import Dict, Any, List, Optional
from PIL import Image
from dotenv import load_dotenv

from .archive_service import save_archive, ArchiveServiceError, _safe_resolve

load_dotenv()

class PanelServiceError(Exception):
    pass

def _get_api_key(api_key: Optional[str] = None) -> str:
    key = api_key or os.environ.get("GEMINI_API_KEY")
    if not key:
        # Retry loading from .env if not found
        from pathlib import Path
        env_path = Path(__file__).parent.parent.parent.parent.parent / ".env"
        if env_path.exists():
            load_dotenv(dotenv_path=env_path)
            key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise PanelServiceError("GEMINI_API_KEY が設定されていません。.env または設定画面をご確認ください。")
    return key.strip()

def split_panels(
    image_bytes: bytes,
    original_filename: str = "image.png",
    reading_order: str = "left_to_right",
    padding: int = 0,
    api_key: Optional[str] = None,
    model_name: str = "gemini-3.8-flash",
    thinking_level: str = "LOW",
    target_folder: Optional[str] = None
) -> Dict[str, Any]:
    """
    Gemini APIを用いて画像から漫画のコマを検出し、各コマを個別PNG画像として切り分けて
    選択されたアーカイブフォルダ（未指定時は YYYYMMDD_HHMMSS_コマ分割）内に保存します。
    後続のPythonツールでも容易にコマ割りを再利用・加工できるよう、
    画像ファイル群に加えて構造化された panels.json を出力します。
    """
    key = _get_api_key(api_key)

    # Normalize model name aliases
    MODEL_ALIASES = {
        "gemini-3.1-pro": "gemini-3.1-pro-preview",
        "gemini-3-pro": "gemini-3.1-pro-preview",
        "gemini-3.8-flash": "gemini-3.8-flash",
    }
    actual_model_name = MODEL_ALIASES.get((model_name or "").lower().strip(), (model_name or "gemini-3.8-flash").strip())

    # 1. Load image via Pillow
    try:
        pil_img = Image.open(io.BytesIO(image_bytes))
        width, height = pil_img.size
    except Exception as e:
        raise PanelServiceError(f"画像ファイルの読み込みに失敗しました: {e}")

    # Determine image format/mime for Gemini
    format_lower = (pil_img.format or "PNG").lower()
    if format_lower in ("jpg", "jpeg"):
        mime_type = "image/jpeg"
    elif format_lower == "webp":
        mime_type = "image/webp"
    else:
        mime_type = "image/png"

    # 2. Call Gemini API for panel detection
    img_b64 = base64.b64encode(image_bytes).decode("utf-8")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{actual_model_name}:generateContent?key={key}"

    reading_order_desc = (
        "Japanese manga reading order (top-to-bottom, right-to-left)"
        if reading_order == "right_to_left"
        else "Western comic reading order (top-to-bottom, left-to-right)"
    )

    prompt = f"""You are an expert manga / comic panel detector.
Analyze this image and accurately detect all individual comic panels (frames / コマ).
Return the bounding box coordinates for each panel.
Order the panels strictly in {reading_order_desc}.

Output a JSON array of objects with the following schema:
[
  {{
    "panel_number": 1,
    "box_2d": [ymin, xmin, ymax, xmax]
  }}
]

Important constraints:
- Coordinates [ymin, xmin, ymax, xmax] MUST be normalized integers from 0 to 1000 relative to the image height and width.
  ymin=0 is top, ymax=1000 is bottom. xmin=0 is left, xmax=1000 is right.
- Ensure the bounding boxes tightly encompass each panel's outer borders/content without cutting off dialogue bubbles or artwork.
- Return ONLY valid JSON, with no markdown fences, no conversational text.
"""

    # Configure generation parameters including thinkingConfig & response_schema
    generation_config: Dict[str, Any] = {
        "response_mime_type": "application/json",
        "temperature": 0.1,
        "response_schema": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "panel_number": {"type": "INTEGER"},
                    "box_2d": {
                        "type": "ARRAY",
                        "items": {"type": "INTEGER"}
                    }
                },
                "required": ["panel_number", "box_2d"]
            }
        }
    }

    # Apply thinkingConfig if model supports it (Gemini 3.x series)
    valid_thinking_levels = ("LOW", "MEDIUM", "HIGH")
    normalized_thinking_level = thinking_level.upper() if thinking_level else "LOW"
    if normalized_thinking_level in valid_thinking_levels:
        generation_config["thinkingConfig"] = {
            "thinkingLevel": normalized_thinking_level
        }

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": img_b64
                        }
                    }
                ]
            }
        ],
        "generationConfig": generation_config
    }

    try:
        resp = requests.post(url, json=payload, timeout=90)
        # Fallback without thinkingConfig / response_schema if unsupported by model version
        if resp.status_code == 400 and ("thinking" in resp.text.lower() or "schema" in resp.text.lower()):
            simple_gen_config = {
                "response_mime_type": "application/json",
                "temperature": 0.1
            }
            fallback_payload = dict(payload)
            fallback_payload["generationConfig"] = simple_gen_config
            resp = requests.post(url, json=fallback_payload, timeout=90)

        if resp.status_code != 200:
            err_msg = resp.text
            try:
                err_json = resp.json()
                if "error" in err_json and "message" in err_json["error"]:
                    err_msg = err_json["error"]["message"]
            except Exception:
                pass
            raise PanelServiceError(f"Gemini API エラー ({resp.status_code}): {err_msg}")

        res_data = resp.json()
        candidates = res_data.get("candidates", [])
        if not candidates:
            raise PanelServiceError("Gemini API から応答が返されませんでした。")

        # When Thinking process is enabled, parts can include thought text.
        # Find the final non-thought text part for the actual JSON response.
        parts = candidates[0].get("content", {}).get("parts", [])
        target_part = None
        for p in reversed(parts):
            if not p.get("thought", False) and "text" in p:
                target_part = p
                break
        if not target_part and parts:
            target_part = parts[-1]

        raw_text = (target_part.get("text", "") if target_part else "").strip()
        # Clean any potential markdown wrapping
        raw_text = re.sub(r"^```json\s*", "", raw_text, flags=re.IGNORECASE)
        raw_text = re.sub(r"\s*```$", "", raw_text)

        parsed_boxes = json.loads(raw_text)
        if not isinstance(parsed_boxes, list):
            if isinstance(parsed_boxes, dict) and "panels" in parsed_boxes:
                parsed_boxes = parsed_boxes["panels"]
            else:
                parsed_boxes = []

    except json.JSONDecodeError as e:
        raise PanelServiceError(f"GeminiからのJSON応答の解析に失敗しました: {e}\nレスポンス: {raw_text}")
    except requests.exceptions.RequestException as e:
        raise PanelServiceError(f"Gemini API への通信に失敗しました: {e}")

    # Fallback: if no panels detected, treat entire image as single panel
    if not parsed_boxes:
        parsed_boxes = [
            {
                "panel_number": 1,
                "box_2d": [0, 0, 1000, 1000]
            }
        ]

    # 3. Crop panels using Pillow
    now = datetime.now()
    timestamp_folder = now.strftime("%Y%m%d_%H%M%S")
    sub_folder_name = f"{timestamp_folder}_コマ分割"
    clean_target = (target_folder or "").strip().replace("\\", "/").strip("/")

    if clean_target:
        # Save into a subfolder inside the selected archive
        root_archive = clean_target.split("/")[0]
        prefix = f"{sub_folder_name}/"
        is_subfolder = True
    else:
        # Fallback: create standalone archive folder in root archives directory
        root_archive = sub_folder_name
        prefix = ""
        is_subfolder = False

    archive_files: List[tuple[str, bytes]] = []

    panel_details = []
    panel_index = 1

    for item in parsed_boxes:
        box = item.get("box_2d")
        if not box or len(box) != 4:
            continue

        ymin, xmin, ymax, xmax = [float(c) for c in box]

        # Convert normalized coordinates (0-1000) to pixel coordinates
        px_ymin = int(round((ymin / 1000.0) * height))
        px_xmin = int(round((xmin / 1000.0) * width))
        px_ymax = int(round((ymax / 1000.0) * height))
        px_xmax = int(round((xmax / 1000.0) * width))

        # Apply padding if requested
        if padding > 0:
            px_ymin = max(0, px_ymin - padding)
            px_xmin = max(0, px_xmin - padding)
            px_ymax = min(height, px_ymax + padding)
            px_xmax = min(width, px_xmax + padding)

        # Ensure valid bbox dimensions
        if px_xmax <= px_xmin or px_ymax <= px_ymin:
            continue

        # Clamp to image boundaries
        px_xmin = max(0, min(width - 1, px_xmin))
        px_ymin = max(0, min(height - 1, px_ymin))
        px_xmax = max(px_xmin + 1, min(width, px_xmax))
        px_ymax = max(px_ymin + 1, min(height, px_ymax))

        cropped_img = pil_img.crop((px_xmin, px_ymin, px_xmax, px_ymax))
        crop_bytes = _to_png_bytes(cropped_img)

        filename = f"{panel_index:02d}.png"
        archive_files.append((f"{prefix}{filename}", crop_bytes))

        panel_info = {
            "panel_number": panel_index,
            "filename": filename,
            "box_2d": [int(ymin), int(xmin), int(ymax), int(xmax)],
            "pixel_box": [px_xmin, px_ymin, px_xmax, px_ymax],
            "xywh": [px_xmin, px_ymin, px_xmax - px_xmin, px_ymax - px_ymin],
            "width": px_xmax - px_xmin,
            "height": px_ymax - px_ymin
        }
        panel_details.append(panel_info)
        panel_index += 1

    if not panel_details:
        raise PanelServiceError("有効なコマを検出・切り分けることができませんでした。")

    # 4. Generate panels.json (Structured data for downstream Python scripts/tools)
    formatted_date = now.strftime("%Y-%m-%d %H:%M:%S")
    panels_meta = {
        "version": "1.0",
        "timestamp": now.isoformat(),
        "created_at": formatted_date,
        "original_filename": original_filename,
        "image_size": {
            "width": width,
            "height": height
        },
        "reading_order": reading_order,
        "model": actual_model_name,
        "thinking_level": normalized_thinking_level,
        "padding": padding,
        "panels_count": len(panel_details),
        "panels": panel_details
    }
    panels_json_bytes = json.dumps(panels_meta, ensure_ascii=False, indent=2).encode("utf-8")
    archive_files.append((f"{prefix}panels.json", panels_json_bytes))

    # 5. Append single-line log to root archive log.txt (not inside subfolder)
    sub_folder_label = sub_folder_name if is_subfolder else "なし"
    log_line = f"[{formatted_date}] コマ分割ツールを実行し、{len(panel_details)}コマに分割しました（元ファイル名 {original_filename}、サブフォルダ名: {sub_folder_label}）"

    try:
        root_log_file = _safe_resolve(root_archive, "log.txt")
        if root_log_file.exists() and root_log_file.is_file():
            prev_content = root_log_file.read_text(encoding="utf-8")
            updated_log = prev_content.rstrip() + "\n" + log_line + "\n"
        else:
            updated_log = log_line + "\n"
        archive_files.append(("log.txt", updated_log.encode("utf-8")))
    except Exception:
        archive_files.append(("log.txt", (log_line + "\n").encode("utf-8")))

    # 6. Save archive using archive_service
    try:
        save_archive(root_archive, archive_files)
    except ArchiveServiceError as e:
        raise PanelServiceError(f"アーカイブの保存に失敗しました: {e}")

    auto_select_key = f"{root_archive}/{prefix}01.png"

    return {
        "status": "success",
        "archive_name": root_archive,
        "sub_folder": sub_folder_name if is_subfolder else None,
        "folder_name": root_archive,
        "auto_select_key": auto_select_key,
        "panels_count": len(panel_details),
        "panels": panel_details,
        "original_filename": original_filename,
        "image_width": width,
        "image_height": height,
        "model": actual_model_name,
        "thinking_level": normalized_thinking_level
    }

def _to_png_bytes(img: Image.Image) -> bytes:
    bio = io.BytesIO()
    # Convert RGBA or RGB if necessary
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    img.save(bio, format="PNG")
    return bio.getvalue()
