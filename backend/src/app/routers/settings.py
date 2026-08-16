from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.settings_service import (
    get_gemini_key_status as svc_get_gemini_key_status,
    save_gemini_key as svc_save_gemini_key,
    get_default_prompts as svc_get_default_prompts,
    save_default_prompts as svc_save_default_prompts,
    SettingsServiceError
)

router = APIRouter(prefix="/settings", tags=["settings"])

class GeminiKeyRequest(BaseModel):
    api_key: str

@router.get("/gemini")
async def get_gemini_key_status():
    """Gemini APIキーが設定されているか確認する"""
    has_key = svc_get_gemini_key_status()
    return {"has_key": has_key}

@router.post("/gemini")
async def set_gemini_key(request: GeminiKeyRequest):
    """Gemini APIキーを .env ファイルに保存する"""
    try:
        svc_save_gemini_key(request.api_key)
        return {"status": "success", "message": "API Key saved to .env"}
    except SettingsServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/prompts")
async def get_default_prompts():
    """Get the saved default prompts for AI tools"""
    return svc_get_default_prompts()

@router.post("/prompts")
async def set_default_prompts(prompts: dict):
    """Save the default prompts for AI tools"""
    try:
        svc_save_default_prompts(prompts)
        return {"status": "success"}
    except SettingsServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))
