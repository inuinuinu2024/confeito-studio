"""Multimodal image generation (the Nano Banana画像生成 tool)."""

from typing import Any

from ..errors import AppError, BadRequestError, exception_text
from ..providers import get_provider
from ..providers.base import GenerationApi, GenerationResult
from ..providers.gemini import GeminiNoImageError
from . import usage_service

TOOL_NAME = "Nano Banana画像生成"


class GenerationServiceError(AppError):
    pass


class GenerationProviderNotFoundError(GenerationServiceError, BadRequestError):
    pass


def _service_tier(payload: dict[str, Any]) -> str | None:
    return payload.get("service_tier") or payload.get("serviceTier")


def _image_size(payload: dict[str, Any], api: GenerationApi) -> str | None:
    if api == "generate_content":
        image_config = (payload.get("generationConfig") or {}).get("imageConfig") or {}
        return image_config.get("imageSize")
    return (payload.get("response_format") or {}).get("image_size")


def _record_usage(payload: dict[str, Any], api: GenerationApi, response: Any, *, success: bool) -> None:
    """Cost Monitor: the call was billed (docs/specs/cost-monitor.md)."""
    usage_service.record_response(
        tool=TOOL_NAME,
        model=str(payload.get("model", "")),
        api=api,
        service_tier=_service_tier(payload),
        status="success" if success else "no_output",
        response=response,
        images=1 if success else 0,
        estimate_image_size=_image_size(payload, api),
    )


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
        result = await gen_provider.generate_multimodal(payload=payload, api_key=api_key, api=api)
    except GeminiNoImageError as e:
        _record_usage(payload, api, e.data, success=False)
        raise
    except AppError:
        raise
    except Exception as e:
        raise GenerationServiceError("画像の生成に失敗しました。", raw_response=exception_text(e)) from e
    _record_usage(payload, api, (result.metadata or {}).get("raw_response"), success=True)
    return result
