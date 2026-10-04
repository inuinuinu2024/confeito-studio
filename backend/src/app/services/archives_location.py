"""The ARCHIVES folder the user chose (設定ウィンドウ「保存先」; docs/specs/archives.md 「保存先」).

The default is ``settings.default_archives_dir`` (<repo>/archives, or ``CONFEITO_ARCHIVES_DIR``). A folder the user
sets is saved as ``app_archivesDir`` in the user's settings (settings/user_settings.json; "" = the default) and
applied with ``settings.use_archives_dir`` at startup and when it changes. Switching only changes where ARCHIVES
reads and writes: nothing is moved, the previous folder keeps its archives.

Refused folders: relative paths, files, and folders that would expose the app's own files to ARCHIVES (deleting
an "archive" moves it to the trash): the project folder, its parents, and folders inside it other than the
default archives folder.
"""

import logging
from pathlib import Path
from typing import Any

from ..config import PROJECT_ROOT, settings
from ..errors import AppError, BadRequestError, exception_text
from . import settings_service

logger = logging.getLogger(__name__)

SETTING_KEY = "app_archivesDir"

_ignored: str | None = None
"""Why the saved folder was not used at startup (shown on the settings page), or None."""


class ArchivesLocationError(AppError):
    pass


def _clean(path: str | None) -> str:
    """Surrounding spaces and quotes removed (paths copied from Explorer come quoted)."""
    return (path or "").strip().strip('"').strip()


def _is_within(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def _validate(text: str) -> Path:
    """The folder as an absolute, resolved path; raises BadRequestError when it cannot be used."""
    folder = Path(text)
    if not folder.is_absolute():
        raise BadRequestError(f"フォルダはフルパス（例: D:\\manga\\archives）で指定してください: {text}")
    folder = folder.resolve()
    if folder.exists() and not folder.is_dir():
        raise BadRequestError(f"フォルダではなくファイルです: {folder}")
    project = PROJECT_ROOT.resolve()
    default = settings.default_archives_dir.resolve()
    if _is_within(project, folder) or (_is_within(folder, project) and not _is_within(folder, default)):
        raise BadRequestError(
            f"アプリのフォルダ（{project}）やその中のフォルダは指定できません。"
            "アプリのファイルが ARCHIVES に表示され、削除できてしまうためです。"
        )
    return folder


def _is_default(folder: Path) -> bool:
    return folder.resolve() == settings.default_archives_dir.resolve()


def status() -> dict[str, Any]:
    """The folder in use, the default, whether the default is used, whether the folder exists, and why a saved
    folder was ignored at startup (``ignored``, or None)."""
    current = settings.archives_dir
    return {
        "path": str(current),
        "default_path": str(settings.default_archives_dir),
        "is_default": _is_default(current),
        "exists": current.is_dir(),
        "ignored": _ignored,
    }


def load() -> None:
    """Applies the saved folder (at startup). A saved value that cannot be used is ignored (see ``status``)."""
    global _ignored
    _ignored = None
    saved = _clean(str(settings_service.load_tool_settings().values.get(SETTING_KEY) or ""))
    settings.use_archives_dir(None)
    if not saved:
        return
    try:
        settings.use_archives_dir(_validate(saved))
    except BadRequestError as e:
        logger.warning("Ignoring the saved archives folder %s: %s", saved, e.message)
        _ignored = f"保存先に設定したフォルダ（{saved}）を使えないため、既定のフォルダを使っています。{e.message}"


def change(path: str, create: bool = False) -> dict[str, Any]:
    """Switches the ARCHIVES folder to ``path`` ("" = the default) and saves it.

    A folder that does not exist is created when ``create`` is true; otherwise nothing changes and the result
    has ``missing: true`` (the frontend asks before creating it).
    """
    global _ignored
    text = _clean(path)
    folder = _validate(text) if text else settings.default_archives_dir.resolve()
    if not folder.exists():
        # The default folder is simply created; another one only after the user agreed.
        if text and not create:
            return {**status(), "missing": True, "changed": False, "requested_path": str(folder)}
        try:
            folder.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            raise ArchivesLocationError(
                f"フォルダを作成できませんでした: {folder}", raw_response=exception_text(e)
            ) from e
    changed = folder != settings.archives_dir.resolve()
    is_default = _is_default(folder)
    settings_service.update_user_settings({SETTING_KEY: "" if is_default else str(folder)})
    settings.use_archives_dir(None if is_default else folder)
    _ignored = None
    return {**status(), "missing": False, "changed": changed, "requested_path": str(folder)}
