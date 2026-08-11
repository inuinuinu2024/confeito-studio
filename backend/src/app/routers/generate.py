from typing import Annotated, Optional, List, Dict, Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Header
from fastapi.responses import Response
from pydantic import BaseModel

from ..providers import provider_factory

router = APIRouter()

class PartModel(BaseModel):
    text: Optional[str] = None
    inline_data: Optional[Dict[str, str]] = None

class ContentModel(BaseModel):
    parts: List[PartModel]

class NanoBananaProRequest(BaseModel):
    contents: List[ContentModel]
    parameters: Optional[Dict[str, Any]] = None

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
    gen_provider = provider_factory.get_provider(provider)
    if not gen_provider:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    try:
        # If an image was uploaded, read it
        image_bytes = None
        if image:
            image_bytes = await image.read()

        result = await gen_provider.generate(
            prompt=prompt,
            image_bytes=image_bytes,
            api_key=api_key,
        )
        
        return Response(content=result.image_bytes, media_type="image/png")
    
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
    gen_provider = provider_factory.get_provider(provider)
    if not gen_provider:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    try:
        # Require the provider to support multimodal generation
        if not hasattr(gen_provider, "generate_multimodal"):
            raise RuntimeError(f"Provider {provider} does not support multimodal generation.")
            
        # Convert pydantic models to dicts to pass to provider
        contents_dict = [c.dict(exclude_none=True) for c in request.contents]
        
        result = await gen_provider.generate_multimodal(
            contents=contents_dict,
            parameters=request.parameters,
            api_key=api_key,
        )
        
        return Response(content=result.image_bytes, media_type="image/png")
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
