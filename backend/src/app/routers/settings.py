"""/api/settings — Gemini API key status and persisted tool settings."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..services import settings_service as svc

router = APIRouter(prefix="/settings", tags=["settings"])


class GeminiKeyRequest(BaseModel):
    api_key: str


@router.get("/gemini")
async def get_gemini_key_status() -> dict:
    return {"has_key": svc.get_gemini_key_status()}


@router.post("/gemini")
async def set_gemini_key(request: GeminiKeyRequest) -> dict:
    """Stores the key in .env and in the running process environment."""
    svc.save_gemini_key(request.api_key)
    return {"status": "success", "message": "API Key saved to .env"}


@router.get("/prompts")
async def get_default_prompts() -> dict[str, Any]:
    """All persisted tool settings (flat map, see settings/default_prompts.json)."""
    return svc.get_default_prompts()


@router.post("/prompts")
async def set_default_prompts(prompts: dict[str, Any]) -> dict:
    svc.save_default_prompts(prompts)
    return {"status": "success"}
