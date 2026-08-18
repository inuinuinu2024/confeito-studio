from typing import Optional, Dict, Any
from ..providers import provider_factory
from ..providers.base import GenerationResult

class GenerationServiceError(Exception):
    pass

class GenerationProviderNotFoundError(GenerationServiceError):
    pass

class GenerationConfigError(GenerationServiceError):
    pass

async def generate_image(
    provider: str,
    prompt: str,
    image_bytes: Optional[bytes],
    api_key: Optional[str]
) -> bytes:
    gen_provider = provider_factory.get_provider(provider)
    if not gen_provider:
        raise GenerationProviderNotFoundError(f"Unsupported provider: {provider}")

    try:
        result = await gen_provider.generate(
            prompt=prompt,
            image_bytes=image_bytes,
            api_key=api_key,
        )
        return result.image_bytes
    except Exception as e:
        raise GenerationServiceError(str(e))

async def generate_nano_banana_pro(
    provider: str,
    payload: Dict[str, Any],
    api_key: Optional[str]
) -> GenerationResult:
    gen_provider = provider_factory.get_provider(provider)
    if not gen_provider:
        raise GenerationProviderNotFoundError(f"Unsupported provider: {provider}")

    if not hasattr(gen_provider, "generate_multimodal"):
        raise GenerationConfigError(f"Provider {provider} does not support multimodal generation.")
        
    try:
        result = await gen_provider.generate_multimodal(
            payload=payload,
            api_key=api_key,
        )
        return result
    except Exception as e:
        raise GenerationServiceError(str(e))
