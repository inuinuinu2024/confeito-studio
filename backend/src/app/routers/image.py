from fastapi import APIRouter, File, UploadFile, HTTPException
from fastapi.responses import Response

from ..services.image_service import remove_background

router = APIRouter(tags=["image"])

@router.post("/image/remove-bg")
async def api_remove_background(image: UploadFile = File(...)):
    """
    Remove background from an uploaded image.
    """
    try:
        image_bytes = await image.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="No image provided")
            
        result_bytes = remove_background(image_bytes)
        return Response(content=result_bytes, media_type="image/png")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
