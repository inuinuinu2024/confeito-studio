"""Multimodal image generation (the Nano Banana画像生成 tool)."""

from typing import Any

from ..errors import AppError, BadRequestError, exception_text
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
        raise GenerationProviderNotFoundError(f"対応していないプロバイダーです: {provider}")
    try:
        return await gen_provider.generate_multimodal(payload=payload, api_key=api_key, api=api)
    except AppError:
        raise
    except Exception as e:
        raise GenerationServiceError("画像の生成に失敗しました。", raw_response=exception_text(e)) from e
