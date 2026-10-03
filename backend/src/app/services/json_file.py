"""JSON object files the app writes in settings/ (user_settings.json, prompts.json).

* A file that cannot be parsed is never overwritten: it is moved aside to
  ``<stem>.broken-<stamp>.json`` and a Japanese warning is returned for the frontend to show.
* Writes go to a temp file that then replaces the file, so a failed write never leaves a
  half-written file.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from ..errors import AppError, exception_text


class JsonFileError(AppError):
    pass


def read_json_object(path: Path) -> dict[str, Any] | None:
    """The JSON object in ``path``: {} when the file is missing, None when it cannot be parsed."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _backup_path(path: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    candidate = path.with_name(f"{path.stem}.broken-{stamp}{path.suffix}")
    n = 2
    while candidate.exists():
        candidate = path.with_name(f"{path.stem}.broken-{stamp}_{n}{path.suffix}")
        n += 1
    return candidate


def read_or_move_aside(path: Path, label: str, loaded_as: str, warnings: list[str]) -> dict[str, Any]:
    """The object in ``path``; a broken file is moved aside (with a warning) and counts as empty.

    ``label`` names the file in messages (e.g. "ユーザー設定ファイル"), ``loaded_as`` ends the
    warning (e.g. "初期設定で読み込みました").
    """
    values = read_json_object(path)
    if values is not None:
        return values
    backup = _backup_path(path)
    try:
        path.replace(backup)
    except OSError as e:
        raise JsonFileError(
            f"{label}（{path.name}）が壊れていて、退避もできませんでした。ファイルを確認してください。",
            raw_response=exception_text(e),
        ) from e
    warnings.append(f"{label}（{path.name}）が壊れていたため {backup.name} に退避し、{loaded_as}。")
    return {}


def write_json_atomic(path: Path, data: dict[str, Any], error_message: str) -> None:
    """Writes ``data`` to a temp file and replaces ``path`` with it; raises ``JsonFileError`` on failure."""
    tmp = path.with_name(f"{path.name}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(path)
    except OSError as e:
        tmp.unlink(missing_ok=True)
        raise JsonFileError(error_message, raw_response=exception_text(e)) from e
