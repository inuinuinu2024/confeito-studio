"""Where the Gemini API key is kept (docs/specs/app-shell.md 「Gemini API キーの扱い」).

Everything that reads or writes the key goes through this module, so the web version (each user
brings their own key, stored encrypted per user on the server) only has to replace what is in here.

Local version: the key is ``GEMINI_API_KEY`` in the .env file (plain text), read on every call so a
saved key is used at once. A ``GEMINI_API_KEY`` environment variable set outside the app is used when
the .env file has none (development / CI). The process environment is never written.
"""

import os

from ..config import read_env_file, settings
from ..errors import AppError, BadRequestError, exception_text

ENV_NAME = "GEMINI_API_KEY"


class SecretStoreError(AppError):
    pass


def get_gemini_key() -> str | None:
    """The saved key, or None when there is none."""
    key = read_env_file(settings.env_file).get(ENV_NAME) or os.environ.get(ENV_NAME)
    return key.strip() if key and key.strip() else None


def has_gemini_key() -> bool:
    return get_gemini_key() is not None


def save_gemini_key(api_key: str) -> None:
    """Writes the key to the .env file (other lines are preserved)."""
    new_key = api_key.strip()
    if not new_key:
        raise BadRequestError("Gemini API Key を入力してください。")
    env_file = settings.env_file
    try:
        lines = env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []
        key_line = f"{ENV_NAME}={new_key}"
        replaced = False
        for i, line in enumerate(lines):
            if line.strip().startswith(f"{ENV_NAME}="):
                lines[i] = key_line
                replaced = True
        if not replaced:
            lines.append(key_line)
        env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except OSError as e:
        raise SecretStoreError("API Key を .env に保存できませんでした。", raw_response=exception_text(e)) from e
