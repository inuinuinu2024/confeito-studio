"""/api/settings — Gemini API key status and the tool settings (initial values + the user's values)."""

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


class ToolSettingsUpdate(BaseModel):
    values: dict[str, Any]


@router.get("/tools")
async def get_tool_settings() -> dict[str, Any]:
    """Tool settings: the initial values with the user's values on top, and warnings to show."""
    result = svc.load_tool_settings()
    return {"values": result.values, "warnings": result.warnings}


@router.post("/tools")
async def update_tool_settings(request: ToolSettingsUpdate) -> dict[str, Any]:
    """Merges ``values`` into the user's settings (other keys are kept)."""
    return {"warnings": svc.update_user_settings(request.values)}
