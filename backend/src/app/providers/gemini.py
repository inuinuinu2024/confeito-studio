"""Google Gemini API access.

Two endpoints are used:
  * Interactions API (``/v1beta/interactions``) — Nano Banana Pro image generation
    via ``GeminiProvider.generate_multimodal``.
  * ``models/{model}:generateContent`` — image generation when Nano Banana Pro selects
    that API (``generate_multimodal(api="generate_content")``), and structured JSON
    output (manga panel detection) via ``generate_content``.

The API key comes from the request (``X-API-Key`` header) or ``GEMINI_API_KEY``.
"""

import asyncio
import base64
import json
import os
from typing import Any, NoReturn

import requests

from ..errors import AppError
from .base import GenerationApi, GenerationResult, ImageGenerationProvider

API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
IMAGE_GENERATION_TIMEOUT_SEC = 600
GENERATE_CONTENT_TIMEOUT_SEC = 90
HIGH_DEMAND_HINT = (
    "\n(Google側のサーバーにリクエストが殺到しており高負荷状態です。しばらく待ってから再度お試しください)"
)


class GeminiAPIError(AppError):
    """Non-200 response from Gemini. ``raw_response`` holds the parsed error body if any."""

    def __init__(self, message: str, *, status_code: int, raw_response: Any = None) -> None:
        super().__init__(message, raw_response=raw_response)
        self.http_status = status_code


def resolve_api_key(api_key: str | None = None) -> str | None:
    key = api_key or os.environ.get("GEMINI_API_KEY")
    return key.strip() if key else None


def _error_message(response: requests.Response) -> tuple[str, Any]:
    """Extracts ``error.message`` from a Gemini error body; falls back to the raw text."""
    message = response.text
    data = None
    try:
        data = json.loads(response.text)
        if "error" in data and "message" in data["error"]:
            message = data["error"]["message"]
    except (ValueError, TypeError):
        pass
    return message, data


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


def raise_for_status(response: requests.Response, label: str = "API Error") -> None:
    if response.status_code == 200:
        return
    message, data = _error_message(response)
    raise GeminiAPIError(
        f"{label} ({response.status_code}): {message}",
        status_code=response.status_code,
        raw_response=data,
    )


def _raise_generation_error(response: requests.Response) -> NoReturn:
    message, data = _error_message(response)
    if "high demand" in message.lower():
        message += HIGH_DEMAND_HINT
    raise GeminiAPIError(
        f"API Error ({response.status_code}): {message}",
        status_code=response.status_code,
        raw_response=data,
    )


def _post_interaction(payload: dict[str, Any], api_key: str) -> dict[str, Any]:
    response = requests.post(
        f"{API_BASE_URL}/interactions",
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json=payload,
        timeout=IMAGE_GENERATION_TIMEOUT_SEC,
    )
    if response.status_code != 200:
        _raise_generation_error(response)
    # With response_format.type = image the API may return the image bytes directly.
    content_type = response.headers.get("Content-Type", "")
    if content_type.startswith("image/"):
        return {"raw_image_bytes": response.content, "mime_type": content_type.split(";")[0]}
    return response.json()


def _post_generate_content(payload: dict[str, Any], api_key: str) -> dict[str, Any]:
    """``payload`` is a generateContent body plus ``model`` (which goes into the URL)."""
    body = {k: v for k, v in payload.items() if k != "model"}
    response = generate_content(payload["model"], body, api_key, timeout=IMAGE_GENERATION_TIMEOUT_SEC)
    if response.status_code != 200:
        _raise_generation_error(response)
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
        raise AppError(f"Interaction ended with status '{status}'. Response: {data}", raw_response=data)
    image = _find_interaction_image(data)
    if not image:
        raise AppError(f"No image data found in response. Response keys: {list(data.keys())}")
    return image


def _generate_content_image(data: dict[str, Any]) -> tuple[str, str | None]:
    block_reason = (data.get("promptFeedback") or {}).get("blockReason")
    if block_reason:
        raise AppError(f"The prompt was blocked (blockReason: {block_reason}).", raw_response=data)
    image = _find_candidate_image(data)
    if not image:
        reasons = [c["finishReason"] for c in data.get("candidates", []) if c.get("finishReason")]
        raise AppError(
            f"No image data found in response (finishReason: {', '.join(reasons) or 'none'}).",
            raw_response=data,
        )
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
            raise AppError("GEMINI_API_KEY is not set.")

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
        except Exception as e:
            raise AppError(
                f"Gemini API multimodal generation failed: {e}",
                raw_response=getattr(e, "raw_response", None),
            ) from e
