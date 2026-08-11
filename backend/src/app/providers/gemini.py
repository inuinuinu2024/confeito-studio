import os
from typing import Any

from .base import GenerationResult, ImageGenerationProvider


class GeminiProvider(ImageGenerationProvider):
    """
    Gemini API を利用して画像を生成するプロバイダー。
    (Interactions API のみサポート)
    """

    def __init__(self) -> None:
        pass

    @property
    def name(self) -> str:
        return "Gemini API"
    
    async def generate(
        self,
        prompt: str,
        *,
        width: int = 512,
        height: int = 512,
        **params: Any,
    ) -> GenerationResult:
        raise NotImplementedError("Standard image generation is no longer supported. Please use Nano Banana Pro (generate_multimodal).")

    async def generate_multimodal(
        self,
        payload: dict,
        api_key: str | None = None,
    ) -> GenerationResult:
        key = api_key or os.environ.get("GEMINI_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY is not set.")

        import asyncio
        import base64
        import requests

        url = "https://generativelanguage.googleapis.com/v1beta/interactions"
        headers = {
            "x-goog-api-key": key,
            "Content-Type": "application/json"
        }
        
        def _post():
            response = requests.post(url, headers=headers, json=payload, timeout=120)
            if response.status_code != 200:
                raise RuntimeError(f"API Error ({response.status_code}): {response.text}")
            
            # The interactions API might return raw image bytes directly if response_format.type = image
            content_type = response.headers.get("Content-Type", "")
            if content_type.startswith("image/"):
                return {"raw_image_bytes": response.content}
            return response.json()
            
        try:
            data = await asyncio.to_thread(_post)
            
            model_name = payload.get("model", "interactions-api")
            if "raw_image_bytes" in data:
                return GenerationResult(
                    image_bytes=data["raw_image_bytes"],
                    width=1024,
                    height=1024,
                    metadata={"model": model_name}
                )
                
            # If it returned JSON, try to find base64 data
            # Check common fields where it might be returned
            b64_data = data.get("image") or data.get("data")
            if not b64_data:
                # Fallback to checking inside standard Gemini JSON structures just in case
                for cand in data.get("candidates", []):
                    for part in cand.get("content", {}).get("parts", []):
                        if "inlineData" in part:
                            b64_data = part["inlineData"].get("data")
                            break
                        if "inline_data" in part:
                            b64_data = part["inline_data"].get("data")
                            break

            if b64_data:
                return GenerationResult(
                    image_bytes=base64.b64decode(b64_data),
                    width=1024,
                    height=1024,
                    metadata={"model": model_name}
                )
            
            raise RuntimeError(f"No image data found in response. Response keys: {list(data.keys())}")
            
        except Exception as e:
            raise RuntimeError(f"Gemini API multimodal generation failed: {e}")
