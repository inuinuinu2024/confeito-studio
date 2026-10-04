"""/api/settings — Gemini API key status, the ARCHIVES folder (保存先) and the tool settings (initial values + the user's values)."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from ..services import archives_location, secret_store
from ..services import settings_service as svc

router = APIRouter(prefix="/settings", tags=["settings"])


class GeminiKeyRequest(BaseModel):
    api_key: str


@router.get("/gemini")
async def get_gemini_key_status() -> dict:
    return {"has_key": secret_store.has_gemini_key()}


@router.post("/gemini")
async def set_gemini_key(request: GeminiKeyRequest) -> dict:
    """Stores the key (services/secret_store.py; the .env file for now)."""
    secret_store.save_gemini_key(request.api_key)
    return {"status": "success", "message": "API Key saved to .env"}


class ArchivesLocationRequest(BaseModel):
    path: str = ""
    """Full path of the folder; "" = back to the default."""
    create: bool = False
    """Create the folder when it does not exist (after the user agreed)."""


@router.get("/archives")
async def get_archives_location() -> dict[str, Any]:
    """``{path, default_path, is_default, exists, ignored}`` of the ARCHIVES folder."""
    return archives_location.status()


@router.post("/archives")
async def set_archives_location(request: ArchivesLocationRequest) -> dict[str, Any]:
    """Switches the ARCHIVES folder (nothing is moved). A missing folder: ``missing: true`` and no change unless
    ``create``. Refused folders are 400 (services/archives_location.py)."""
    return await run_in_threadpool(archives_location.change, request.path, request.create)


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
