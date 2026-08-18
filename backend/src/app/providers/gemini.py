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
            response = requests.post(url, headers=headers, json=payload, timeout=600)
            if response.status_code != 200:
                error_msg = response.text
                try:
                    import json
                    err_data = json.loads(response.text)
                    if "error" in err_data and "message" in err_data["error"]:
                        error_msg = err_data["error"]["message"]
                except Exception:
                    pass
                
                if "high demand" in error_msg.lower():
                    error_msg = f"{error_msg}\n(Google側のサーバーにリクエストが殺到しており高負荷状態です。しばらく待ってから再度お試しください)"
                    
                raise RuntimeError(f"API Error ({response.status_code}): {error_msg}")
            
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
            
            # Check Interactions API status
            status = data.get("status")
            if status and status not in ("completed",):
                raise RuntimeError(f"Interaction ended with status '{status}'. Response: {data}")
            
            b64_data = None
            mime_type = "image/png"

            # 1) Interactions API: steps[].content[] with type="image"
            for step in data.get("steps", []):
                for block in step.get("content", []):
                    if block.get("type") == "image" and block.get("data"):
                        b64_data = block["data"]
                        mime_type = block.get("mime_type", mime_type)
                        break
                if b64_data:
                    break

            # 2) Convenience property: output_image
            if not b64_data:
                output_image = data.get("output_image")
                if output_image and isinstance(output_image, dict):
                    b64_data = output_image.get("data")
                    mime_type = output_image.get("mime_type", mime_type)

            # 3) Fallback: top-level fields
            if not b64_data:
                b64_data = data.get("image") or data.get("data")

            # 4) Legacy Gemini candidates structure
            if not b64_data:
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
                    metadata={"model": model_name, "raw_response": data}
                )
            
            raise RuntimeError(f"No image data found in response. Response keys: {list(data.keys())}")
            
        except Exception as e:
            raise RuntimeError(f"Gemini API multimodal generation failed: {e}")
