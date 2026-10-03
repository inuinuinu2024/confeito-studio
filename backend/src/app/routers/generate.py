"""/api/nano-banana-pro — multimodal image generation (Gemini Interactions API / generateContent)."""

from typing import Any

from fastapi import APIRouter, Header
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from ..providers.base import GenerationApi, GenerationResult
from ..services.generation_service import generate_image

router = APIRouter(tags=["generate"])


class NanoBananaProRequest(BaseModel):
    """Interactions API payload built by the Nano Banana画像生成 tool (frontend features/tools/nano-banana-pro/).

    Only these fields are forwarded; anything else is dropped.
    """

    model: str
    input: list[dict[str, Any]]
    response_format: dict[str, Any]
    generation_config: dict[str, Any] | None = None
    system_instruction: str | None = None
    tools: list[dict[str, Any]] | None = None
    store: bool | None = None
    service_tier: str | None = None


class GenerateContentRequest(BaseModel):
    """generateContent body built by the Nano Banana画像生成 tool, plus ``model`` (moved into the URL by the provider).

    Only these fields are forwarded; anything else is dropped.
    """

    model_config = ConfigDict(populate_by_name=True)

    model: str
    contents: list[dict[str, Any]]
    generation_config: dict[str, Any] | None = Field(default=None, alias="generationConfig")
    safety_settings: list[dict[str, Any]] | None = Field(default=None, alias="safetySettings")
    system_instruction: dict[str, Any] | None = Field(default=None, alias="systemInstruction")
    tools: list[dict[str, Any]] | None = None
    service_tier: str | None = Field(default=None, alias="serviceTier")
    store: bool | None = None


async def _generate(
    payload: dict[str, Any],
    api: GenerationApi,
    provider: str,
    api_key: str | None,
    requested_mime: str | None,
) -> Response:
    result: GenerationResult = await generate_image(provider=provider, payload=payload, api_key=api_key, api=api)
    return Response(content=result.image_bytes, media_type=result.mime_type or requested_mime or "image/png")


@router.post("/nano-banana-pro")
async def api_generate_nano_banana_pro(
    request: NanoBananaProRequest,
    provider: str = Header(default="gemini", alias="X-Provider"),
    api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> Response:
    """Interactions API. Returns the image bytes (Content-Type = the image's MIME type).

    Errors: ``detail`` = Japanese message, or ``{message, raw_response}`` with Gemini's
    response / the exception text (safety blocks etc.; the frontend shows it in the error toast).
    """
    return await _generate(
        request.model_dump(exclude_none=True),
        "interactions",
        provider,
        api_key,
        request.response_format.get("mime_type"),
    )


@router.post("/nano-banana-pro/generate-content")
async def api_generate_nano_banana_pro_generate_content(
    request: GenerateContentRequest,
    provider: str = Header(default="gemini", alias="X-Provider"),
    api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> Response:
    """generateContent API. Same responses and errors as ``/nano-banana-pro``."""
    return await _generate(
        request.model_dump(exclude_none=True, by_alias=True),
        "generate_content",
        provider,
        api_key,
        None,
    )
