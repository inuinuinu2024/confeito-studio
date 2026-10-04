"""Google Gemini API access.

Two endpoints are used:
  * Interactions API (``/v1beta/interactions``) — image generation of the Nano Banana画像生成 tool
    via ``GeminiProvider.generate_multimodal``.
  * ``models/{model}:generateContent`` — image generation when the Nano Banana画像生成 tool selects
    that API (``generate_multimodal(api="generate_content")``), and structured JSON
    output (manga panel detection) via ``generate_content``.

The API key comes from the request (``X-API-Key`` header) or the saved one (services/secret_store.py).
"""

import asyncio
import base64
import json
from typing import Any

import requests

from ..errors import AppError, BadRequestError, exception_text
from ..services import secret_store
from .base import GenerationApi, GenerationResult, ImageGenerationProvider
from .gemini_reasons import describe_no_image

API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
IMAGE_GENERATION_TIMEOUT_SEC = 600
GENERATE_CONTENT_TIMEOUT_SEC = 90
MISSING_API_KEY_MESSAGE = "Gemini API Key が設定されていません。右上の設定アイコンから設定してください。"
HIGH_DEMAND_HINT = "Google 側のサーバーが高負荷です。しばらく待ってから再度お試しください。"


class GeminiAPIError(AppError):
    """Non-200 response from Gemini. ``raw_response`` holds the parsed error body if any."""

    def __init__(self, message: str, *, status_code: int, raw_response: Any = None) -> None:
        super().__init__(message, raw_response=raw_response)
        self.http_status = status_code


class GeminiNoImageError(AppError):
    """Gemini answered but without an image (blocked or filtered). Not a server failure, hence 422."""

    status_code = 422

    def __init__(self, data: Any, *, status: str | None = None) -> None:
        message, raw = describe_no_image(data, status=status)
        super().__init__(message, raw_response=raw)
        self.data = data
        """The whole response (it is still billed: the Cost Monitor records its usage)."""


def resolve_api_key(api_key: str | None = None) -> str | None:
    """The key given with the request (``X-API-Key``), else the saved one (services/secret_store.py)."""
    if api_key and api_key.strip():
        return api_key.strip()
    return secret_store.get_gemini_key()


def _error_body(response: requests.Response) -> Any:
    """The parsed Gemini error body, or the raw text when it is not JSON."""
    try:
        return json.loads(response.text)
    except (ValueError, TypeError):
        return response.text


def generate_content(
    model: str,
    payload: dict[str, Any],
    api_key: str,
    timeout: float = GENERATE_CONTENT_TIMEOUT_SEC,
) -> requests.Response:
    """POSTs to ``models/{model}:generateContent``; returns the raw response (any status)."""
    return requests.post(
        f"{API_BASE_URL}/models/{model}:generateContent",
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json=payload,
        timeout=timeout,
    )


def raise_for_status(response: requests.Response) -> None:
    """Raises ``GeminiAPIError`` (Japanese message, Gemini's error body as raw_response) unless 200."""
    if response.status_code == 200:
        return
    message = f"Gemini API がエラーを返しました（HTTP {response.status_code}）。"
    if "high demand" in response.text.lower():
        message += HIGH_DEMAND_HINT
    raise GeminiAPIError(message, status_code=response.status_code, raw_response=_error_body(response))


def _post_interaction(payload: dict[str, Any], api_key: str) -> dict[str, Any]:
    response = requests.post(
        f"{API_BASE_URL}/interactions",
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json=payload,
        timeout=IMAGE_GENERATION_TIMEOUT_SEC,
    )
    raise_for_status(response)
    # With response_format.type = image the API may return the image bytes directly.
    content_type = response.headers.get("Content-Type", "")
    if content_type.startswith("image/"):
        return {"raw_image_bytes": response.content, "mime_type": content_type.split(";")[0]}
    return response.json()


def _post_generate_content(payload: dict[str, Any], api_key: str) -> dict[str, Any]:
    """``payload`` is a generateContent body plus ``model`` (which goes into the URL)."""
    body = {k: v for k, v in payload.items() if k != "model"}
    response = generate_content(payload["model"], body, api_key, timeout=IMAGE_GENERATION_TIMEOUT_SEC)
    raise_for_status(response)
    return response.json()


def sniff_image_mime(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _find_interaction_image(data: dict[str, Any]) -> tuple[str, str | None] | None:
    """Locates (base64 data, MIME type) in the response shapes the Interactions API has used."""
    # 1) steps[].content[] with type="image"
    for step in data.get("steps", []):
        for block in step.get("content", []):
            if block.get("type") == "image" and block.get("data"):
                return block["data"], block.get("mime_type")
    # 2) Convenience property: output_image
    output_image = data.get("output_image")
    if isinstance(output_image, dict) and output_image.get("data"):
        return output_image["data"], output_image.get("mime_type")
    # 3) Top-level fields
    if data.get("image") or data.get("data"):
        return data.get("image") or data.get("data"), None
    # 4) generateContent-style candidates
    return _find_candidate_image(data)


def _find_candidate_image(data: dict[str, Any]) -> tuple[str, str | None] | None:
    """generateContent: the last non-thought inline image of the first candidate that has one.

    Gemini 3 image models may return interim "thought images" (parts with ``thought: true``)
    before the final image.
    """
    for candidate in data.get("candidates", []):
        found = None
        for part in (candidate.get("content") or {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data") and not part.get("thought"):
                found = (inline["data"], inline.get("mimeType") or inline.get("mime_type"))
        if found:
            return found
    return None


def _interaction_image(data: dict[str, Any]) -> tuple[str, str | None]:
    status = data.get("status")
    if status and status != "completed":
        raise GeminiNoImageError(data, status=status)
    image = _find_interaction_image(data)
    if not image:
        raise GeminiNoImageError(data)
    return image


def _generate_content_image(data: dict[str, Any]) -> tuple[str, str | None]:
    if (data.get("promptFeedback") or {}).get("blockReason"):
        raise GeminiNoImageError(data)
    image = _find_candidate_image(data)
    if not image:
        raise GeminiNoImageError(data)
    return image


class GeminiProvider(ImageGenerationProvider):
    """Image generation through the Gemini Interactions API or generateContent."""

    @property
    def name(self) -> str:
        return "Gemini API"

    async def generate_multimodal(
        self,
        payload: dict[str, Any],
        api_key: str | None = None,
        api: GenerationApi = "interactions",
    ) -> GenerationResult:
        key = resolve_api_key(api_key)
        if not key:
            # A setting the user has to fix, not a server failure (400, like コマ分割).
            raise BadRequestError(MISSING_API_KEY_MESSAGE)

        model_name = payload.get("model", "interactions-api")
        try:
            if api == "generate_content":
                data = await asyncio.to_thread(_post_generate_content, payload, key)
                b64_data, mime_type = _generate_content_image(data)
            else:
                data = await asyncio.to_thread(_post_interaction, payload, key)
                if "raw_image_bytes" in data:
                    return GenerationResult(
                        image_bytes=data["raw_image_bytes"],
                        width=1024,
                        height=1024,
                        metadata={"model": model_name},
                        mime_type=data["mime_type"],
                    )
                b64_data, mime_type = _interaction_image(data)

            image_bytes = base64.b64decode(b64_data)
            return GenerationResult(
                image_bytes=image_bytes,
                width=1024,
                height=1024,
                metadata={"model": model_name, "raw_response": data},
                mime_type=mime_type or sniff_image_mime(image_bytes),
            )
        except AppError:
            raise
        except Exception as e:  # network errors, timeouts, broken image data
            raise AppError("Gemini API での画像生成に失敗しました。", raw_response=exception_text(e)) from e
