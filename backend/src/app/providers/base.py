"""Image generation provider interface (Provider pattern).

A provider receives the request payload built by the frontend tool (see
``frontend/src/features/tools/gemini-image/`` and ``features/tools/nano-banana-pro/``)
and returns the generated image.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal

GenerationApi = Literal["interactions", "generate_content"]
"""Which upstream API the payload is written for (Gemini Interactions or generateContent)."""


@dataclass
class GenerationResult:
    image_bytes: bytes
    width: int
    height: int
    metadata: dict[str, Any] | None = None
    """Provider specific data such as the model name and the raw API response."""
    mime_type: str | None = None
    """MIME type of ``image_bytes`` as reported by the API (or sniffed), if known."""


class ImageGenerationProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        """Human readable provider name."""

    @abstractmethod
    async def generate_multimodal(
        self,
        payload: dict[str, Any],
        api_key: str | None = None,
        api: GenerationApi = "interactions",
    ) -> GenerationResult:
        """Generates one image. ``payload`` is the request body of ``api`` (always including ``model``)."""
