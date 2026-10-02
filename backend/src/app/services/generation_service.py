"""Multimodal image generation (Nano Banana Pro)."""

from typing import Any

from ..errors import AppError, BadRequestError
from ..providers import get_provider
from ..providers.base import GenerationApi, GenerationResult


class GenerationServiceError(AppError):
    pass


class GenerationProviderNotFoundError(GenerationServiceError, BadRequestError):
    pass


async def generate_image(
    provider: str,
    payload: dict[str, Any],
    api_key: str | None,
    api: GenerationApi = "interactions",
) -> GenerationResult:
    """``payload`` is the request body of ``api`` (Interactions or generateContent, plus ``model``)."""
    gen_provider = get_provider(provider)
    if not gen_provider:
        raise GenerationProviderNotFoundError(f"Unsupported provider: {provider}")
    try:
        return await gen_provider.generate_multimodal(payload=payload, api_key=api_key, api=api)
    except Exception as e:
        raise GenerationServiceError(str(e), raw_response=getattr(e, "raw_response", None)) from e
