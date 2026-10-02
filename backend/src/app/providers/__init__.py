"""Registry of image generation providers, selected by the ``X-Provider`` header."""

from .base import ImageGenerationProvider
from .gemini import GeminiProvider

_PROVIDERS: dict[str, ImageGenerationProvider] = {
    "gemini": GeminiProvider(),
}


def get_provider(name: str) -> ImageGenerationProvider | None:
    return _PROVIDERS.get(name)
