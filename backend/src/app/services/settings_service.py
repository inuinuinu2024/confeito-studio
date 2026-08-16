import os
import json
from pathlib import Path
from typing import Dict, Any

class SettingsServiceError(Exception):
    pass

class SettingsNotFoundError(SettingsServiceError):
    pass

ENV_FILE_PATH = Path(__file__).parent.parent.parent.parent.parent / ".env"
PROJECT_ROOT = ENV_FILE_PATH.parent
SETTINGS_DIR = PROJECT_ROOT / "settings"
SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
PROMPTS_FILE_PATH = SETTINGS_DIR / "default_prompts.json"

def get_gemini_key_status() -> bool:
    key = os.environ.get("GEMINI_API_KEY")
    return bool(key)

def save_gemini_key(api_key: str) -> None:
    try:
        new_key = api_key.strip()
        
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
    except Exception as e:
        raise SettingsServiceError(f"Failed to save API key: {str(e)}")

def get_default_prompts() -> Dict[str, Any]:
    if not PROMPTS_FILE_PATH.exists():
        return {}
    try:
        with open(PROMPTS_FILE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_default_prompts(prompts: Dict[str, Any]) -> None:
    try:
        with open(PROMPTS_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(prompts, f, ensure_ascii=False, indent=2)
    except Exception as e:
        raise SettingsServiceError(f"Failed to save prompts: {str(e)}")
