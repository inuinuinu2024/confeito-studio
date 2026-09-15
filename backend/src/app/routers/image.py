from typing import Optional
from fastapi import APIRouter, File, UploadFile, Form, Header, HTTPException
from fastapi.responses import Response

from ..services.image_service import remove_background
from ..services.panel_service import split_panels, PanelServiceError

router = APIRouter(tags=["image"])

@router.post("/image/remove-bg")
async def api_remove_background(
    image: UploadFile = File(...),
    alpha_matting: bool = Form(False),
    alpha_matting_foreground_threshold: int = Form(240),
    alpha_matting_background_threshold: int = Form(10),
    alpha_matting_erode_size: int = Form(10)
):
    """
    Remove background from an uploaded image.
    """
    try:
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="No image provided")
            
        result_bytes = remove_background(
            image_bytes,
            alpha_matting=alpha_matting,
            alpha_matting_foreground_threshold=alpha_matting_foreground_threshold,
            alpha_matting_background_threshold=alpha_matting_background_threshold,
            alpha_matting_erode_size=alpha_matting_erode_size
        )
        return Response(content=result_bytes, media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/image/split-panels")
async def api_split_panels(
    image: UploadFile = File(...),
    reading_order: str = Form("left_to_right"),
    padding: int = Form(0),
    original_filename: str = Form("image.png"),
    model_name: str = Form("gemini-3.8-flash"),
    thinking_level: str = Form("LOW"),
    target_folder: Optional[str] = Form(None),
    api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """
    Detect comic/manga panels using Gemini and split them into separate PNG images
    saved inside the selected archive folder (or a new timestamped folder).
    """
    try:
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="画像データが提供されていません")

        result = split_panels(
            image_bytes=image_bytes,
            original_filename=original_filename,
            reading_order=reading_order,
            padding=padding,
            api_key=api_key,
            model_name=model_name,
            thinking_level=thinking_level,
            target_folder=target_folder,
        )
        return result
    except PanelServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"コマ分割処理中にエラーが発生しました: {str(e)}")

