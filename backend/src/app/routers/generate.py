from typing import Annotated, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Header
from fastapi.responses import Response

from ..providers import provider_factory

router = APIRouter()

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
