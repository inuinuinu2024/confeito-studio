from typing import Optional, List, Dict, Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Header
from fastapi.responses import Response
from pydantic import BaseModel

from ..services.generation_service import (
    generate_image as svc_generate_image,
    generate_nano_banana_pro as svc_generate_nano_banana_pro,
    GenerationProviderNotFoundError,
    GenerationConfigError,
    GenerationServiceError
)

router = APIRouter()

class NanoBananaProRequest(BaseModel):
    model: str
    input: List[Dict[str, Any]]
    response_format: Dict[str, Any]

@router.post("")
async def generate_image(
    prompt: str = Form(...),
    image: Optional[UploadFile] = File(None),
    provider: str = Header(default="gemini", alias="X-Provider"),
    api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
):
    """
    Generate an image using the specified provider.
    """
    try:
        image_bytes = None
        if image:
            image_bytes = await image.read()

        result_bytes = await svc_generate_image(
            provider=provider,
            prompt=prompt,
            image_bytes=image_bytes,
            api_key=api_key
        )
        
        return Response(content=result_bytes, media_type="image/png")
    
    except GenerationProviderNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except GenerationServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/nano-banana-pro")
async def generate_nano_banana_pro(
    request: NanoBananaProRequest,
    provider: str = Header(default="gemini", alias="X-Provider"),
    api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
):
    """
    Generate an image using the multimodal Interactions API format (Nano Banana Pro).
    """
    try:
        result_bytes = await svc_generate_nano_banana_pro(
            provider=provider,
            payload=request.dict(exclude_none=True),
            api_key=api_key
        )
        
        mime_type = request.response_format.get("mime_type", "image/png")
        return Response(content=result_bytes, media_type=mime_type)
    
    except GenerationProviderNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except GenerationConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except GenerationServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
