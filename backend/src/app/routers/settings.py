import os
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/settings", tags=["settings"])

ENV_FILE_PATH = Path(__file__).parent.parent.parent.parent.parent / ".env"

class GeminiKeyRequest(BaseModel):
    api_key: str

@router.get("/gemini")
async def get_gemini_key_status():
    """Gemini APIキーが設定されているか確認する"""
    key = os.environ.get("GEMINI_API_KEY")
    return {"has_key": bool(key)}

@router.post("/gemini")
async def set_gemini_key(request: GeminiKeyRequest):
    """Gemini APIキーを .env ファイルに保存する"""
    new_key = request.api_key.strip()
    
    # 1. Update os.environ
    os.environ["GEMINI_API_KEY"] = new_key
    
    # 2. Update .env file
    env_vars = {}
    if ENV_FILE_PATH.exists():
        with open(ENV_FILE_PATH, "r", encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    env_vars[k.strip()] = v.strip()
    
    env_vars["GEMINI_API_KEY"] = new_key
    
    with open(ENV_FILE_PATH, "w", encoding="utf-8") as f:
        for k, v in env_vars.items():
            f.write(f"{k}={v}\n")
            
    return {"status": "success", "message": "API Key saved to .env"}

PROJECT_ROOT = ENV_FILE_PATH.parent
SETTINGS_DIR = PROJECT_ROOT / "settings"
SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
PROMPTS_FILE_PATH = SETTINGS_DIR / "default_prompts.json"

@router.get("/prompts")
async def get_default_prompts():
    """Get the saved default prompts for AI tools"""
    if not PROMPTS_FILE_PATH.exists():
        return {}
    try:
        import json
        with open(PROMPTS_FILE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

@router.post("/prompts")
async def set_default_prompts(prompts: dict):
    """Save the default prompts for AI tools"""
    try:
        import json
        with open(PROMPTS_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(prompts, f, ensure_ascii=False, indent=2)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save prompts: {e}")
