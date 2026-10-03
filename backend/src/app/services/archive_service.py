"""Folder-based archive storage.

Layout (under ``settings.archives_dir``)::

    <archive>/                       top-level folder, e.g. "20260101_100000_image"
        <file or sub/dir>
    .trash/<archive>/                deleted archives (restore_archive)
    .trash/.items/<archive>/<path>   files / sub-folders deleted from an archive (restore_archive_contents)

``.trash`` is emptied when the backend starts (``empty_trash``), so deletions are only
undoable within one app session.

Tool results are written with ``save_result`` (one folder per run, plus info.json).
The frontend addresses entries with keys of the form ``"<archive>/<relative path>"``.
Every path is resolved through ``resolve_path`` which rejects traversal outside the
archive folder. Archive names starting with "." are reserved for these folders.
"""

import json
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict

from ..config import settings
from ..errors import AppError, BadRequestError, NotFoundError, exception_text

logger = logging.getLogger(__name__)

MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".json": "application/json",
    ".txt": "text/plain",
    ".md": "text/plain",
}


class ArchiveServiceError(AppError):
    pass


class ArchiveNotFoundError(ArchiveServiceError, NotFoundError):
    pass


class ArchiveValidationError(ArchiveServiceError, BadRequestError):
    pass


class ResultInfo(TypedDict):
    """What a tool tells about its result; ``save_result`` writes it as info.json."""

    tool: str
    source: str | None
    settings: dict[str, Any]


RESULT_INFO_FILE = "info.json"


class ArchiveEntry(TypedDict):
    """One row of the ARCHIVES tree (mirrors the frontend ``ArchiveEntry`` type)."""

    key: str
    name: str
    type: Literal["folder", "image"]
    folderId: str | None
    timestamp: int
    collapsed: NotRequired[bool]
    blob: NotRequired[None]


# ── Path helpers ──────────────────────────────────────────────────────


def normalize_rel_path(path: str) -> str:
    """Converts backslashes to slashes and strips leading/trailing slashes."""
    return path.replace("\\", "/").strip("/")


def split_archive_path(path: str) -> tuple[str, str]:
    """``"root/sub/file.png"`` -> ``("root", "sub/file.png")``; ``"root"`` -> ``("root", "")``."""
    root, _, rest = normalize_rel_path(path).partition("/")
    return root, rest


ITEM_TRASH = ".items"
"""Folder in ``.trash`` that holds files / sub-folders deleted from inside an archive."""


def validate_archive_name(name: str) -> None:
    if not name or name.startswith(".") or ".." in name or "/" in name or "\\" in name:
        raise ArchiveValidationError(f"アーカイブ名が正しくありません: {name}")


def _resolve_inside(base_dir: Path, relative_path: str) -> Path:
    target = (base_dir / normalize_rel_path(relative_path)).resolve()
    if target == base_dir or not target.is_relative_to(base_dir):
        raise ArchiveValidationError("アーカイブの外を指すパスは使えません。", raw_response=relative_path)
    return target


def resolve_path(archive_name: str, relative_path: str = "") -> Path:
    """Absolute path of ``relative_path`` inside ``archive_name``; rejects path traversal."""
    validate_archive_name(archive_name)
    base_dir = (settings.archives_dir / archive_name).resolve()
    return _resolve_inside(base_dir, relative_path) if relative_path else base_dir


def _item_trash_dir(archive_name: str) -> Path:
    validate_archive_name(archive_name)
    return (settings.trash_dir / ITEM_TRASH / archive_name).resolve()


def _outermost(paths: list[str]) -> list[str]:
    """Normalized, de-duplicated paths, dropping entries nested inside another entry."""
    result: list[str] = []
    for path in sorted({normalize_rel_path(p) for p in paths} - {""}):
        if not any(path.startswith(f"{parent}/") for parent in result):
            result.append(path)
    return result


def _prune_empty_dirs(root: Path) -> None:
    """Removes empty folders below ``root`` (``root`` itself is kept)."""
    for current, _dirs, _files in os.walk(root, topdown=False):
        if current != str(root) and not os.listdir(current):
            os.rmdir(current)


def _existing_archive_dir(archive_name: str) -> Path:
    archive_dir = resolve_path(archive_name)
    if not archive_dir.is_dir():
        raise ArchiveNotFoundError(f"アーカイブ「{archive_name}」が見つかりません。")
    return archive_dir


def _remove(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


# ── Queries ───────────────────────────────────────────────────────────


def list_archives() -> list[ArchiveEntry]:
    """Top-level archive folders, newest first (hidden folders such as .trash excluded)."""
    root = settings.archives_dir
    if not root.exists():
        return []
    folders = [p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")]
    folders.sort(key=os.path.getmtime, reverse=True)
    return [
        {
            "key": folder.name,
            "name": folder.name,
            "type": "folder",
            "folderId": None,
            "timestamp": int(folder.stat().st_mtime * 1000),
            "collapsed": True,
        }
        for folder in folders
    ]


def list_archive_contents(archive_name: str) -> list[ArchiveEntry]:
    """Flat list of every sub-folder and file in an archive; ``folderId`` links each to its parent."""
    archive_dir = _existing_archive_dir(archive_name)
    timestamp = int(archive_dir.stat().st_mtime * 1000)
    entries: list[ArchiveEntry] = []
    added_folders: set[str] = set()

    for root, _dirs, files in os.walk(archive_dir):
        rel_root = os.path.relpath(root, archive_dir).replace("\\", "/")

        if rel_root != ".":
            current_path = ""
            for part in rel_root.split("/"):
                parent_id = f"{archive_name}/{current_path}" if current_path else archive_name
                current_path = f"{current_path}/{part}" if current_path else part
                folder_key = f"{archive_name}/{current_path}"
                if folder_key not in added_folders:
                    entries.append(
                        {
                            "key": folder_key,
                            "name": part,
                            "type": "folder",
                            "folderId": parent_id,
                            "timestamp": timestamp,
                            "collapsed": False,
                        }
                    )
                    added_folders.add(folder_key)

        parent_id = f"{archive_name}/{rel_root}" if rel_root != "." else archive_name
        for file_name in files:
            file_rel_path = f"{rel_root}/{file_name}" if rel_root != "." else file_name
            entries.append(
                {
                    "key": f"{archive_name}/{file_rel_path}",
                    "name": file_name,
                    "type": "image",
                    "folderId": parent_id,
                    "timestamp": timestamp,
                    "blob": None,
                }
            )

    return entries


def extract_file(archive_name: str, path: str) -> tuple[bytes, str]:
    """Returns ``(content, mime_type)`` of a file inside an archive."""
    target = resolve_path(archive_name, path)
    if not target.is_file():
        raise ArchiveNotFoundError(f"アーカイブ「{archive_name}」に {path} が見つかりません。")
    try:
        content = target.read_bytes()
    except OSError as e:
        raise ArchiveServiceError("ファイルを読み込めませんでした。", raw_response=exception_text(e)) from e
    return content, MIME_TYPES.get(target.suffix.lower(), "application/octet-stream")


# ── Mutations ─────────────────────────────────────────────────────────


def save_archive(name: str, files_data: list[tuple[str, bytes]]) -> str:
    """Creates the archive if needed and writes (or overwrites) the given files."""
    archive_dir = resolve_path(name)
    targets = [(resolve_path(name, rel_path), content) for rel_path, content in files_data]
    try:
        archive_dir.mkdir(parents=True, exist_ok=True)
        for target, content in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    except OSError as e:
        raise ArchiveServiceError("アーカイブに保存できませんでした。", raw_response=exception_text(e)) from e
    return name


def _unique_name(parent: Path, name: str) -> str:
    """``name``, or ``name_2``, ``name_3`` ... when ``parent`` already has an entry with that name."""
    candidate, n = name, 1
    while (parent / candidate).exists():
        n += 1
        candidate = f"{name}_{n}"
    return candidate


def save_result(
    root: str | None,
    folder_name: str,
    files_data: list[tuple[str, bytes]],
    info: ResultInfo | None = None,
    now: datetime | None = None,
) -> str:
    """Saves a tool result and returns its folder key (docs/specs/archives.md 「ツールの結果の保存」).

    * ``root`` given -> ``<root>/<folder_name>/`` (only the top-level part of ``root`` is used)
    * no ``root``    -> new archive ``<folder_name>``

    An existing folder is never overwritten: ``_2``, ``_3`` ... is appended instead.
    ``info`` is written as info.json with ``created_at`` and ``outputs`` added.
    """
    root_name = split_archive_path(root)[0] if root else ""
    validate_archive_name(folder_name)
    if root_name:
        name = _unique_name(resolve_path(root_name), folder_name)
        archive, prefix, key = root_name, f"{name}/", f"{root_name}/{name}"
    else:
        name = _unique_name(settings.archives_dir, folder_name)
        archive, prefix, key = name, "", name

    files = [(f"{prefix}{path}", content) for path, content in files_data]
    if info is not None:
        record = {
            "tool": info["tool"],
            "created_at": f"{now or datetime.now():%Y-%m-%d %H:%M:%S}",
            "source": info.get("source"),
            "settings": info.get("settings") or {},
            "outputs": [path for path, _ in files_data],
        }
        files.append((f"{prefix}{RESULT_INFO_FILE}", json.dumps(record, ensure_ascii=False, indent=2).encode("utf-8")))
    save_archive(archive, files)
    return key


def parse_result_info(text: str | None) -> ResultInfo | None:
    """The ``info`` form field of POST /archives/results (JSON), or None when absent."""
    if not text:
        return None
    try:
        data = json.loads(text)
    except ValueError as e:
        raise ArchiveValidationError("info が JSON として読めません。", raw_response=exception_text(e)) from e
    if not isinstance(data, dict) or not isinstance(data.get("tool"), str):
        raise ArchiveValidationError("info に tool（ツール名）がありません。", raw_response=text)
    return {"tool": data["tool"], "source": data.get("source"), "settings": data.get("settings") or {}}


def delete_archive(archive_name: str) -> None:
    """Moves an archive into ``.trash`` (replacing an older trashed copy)."""
    archive_dir = _existing_archive_dir(archive_name)
    trash_target = settings.trash_dir / archive_name
    try:
        settings.trash_dir.mkdir(parents=True, exist_ok=True)
        _remove(trash_target)
        shutil.move(str(archive_dir), str(trash_target))
    except OSError as e:
        raise ArchiveServiceError("アーカイブを削除できませんでした。", raw_response=exception_text(e)) from e


def delete_archive_contents(archive_name: str, paths: list[str]) -> None:
    """Moves files/sub-folders into ``.trash/.items/<archive>/`` (undo: ``restore_archive_contents``).

    Empty folders left behind are pruned; the archive folder itself is removed when nothing
    is left in it. An older trashed copy of the same path is replaced.
    """
    archive_dir = _existing_archive_dir(archive_name)
    trash_dir = _item_trash_dir(archive_name)
    moves = [(resolve_path(archive_name, p), _resolve_inside(trash_dir, p)) for p in _outermost(paths)]
    try:
        for source, dest in moves:
            if not source.exists():
                continue
            _remove(dest)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(dest))
        _prune_empty_dirs(archive_dir)
        if not any(archive_dir.iterdir()):
            archive_dir.rmdir()
    except OSError as e:
        raise ArchiveServiceError("ファイルを削除できませんでした。", raw_response=exception_text(e)) from e


def restore_archive_contents(archive_name: str, paths: list[str]) -> None:
    """Moves files/sub-folders back from ``.trash/.items/<archive>/`` to their original paths.

    Recreates the archive folder if it was removed; anything now at those paths is replaced.
    """
    trash_dir = _item_trash_dir(archive_name)
    moves = [(_resolve_inside(trash_dir, p), resolve_path(archive_name, p)) for p in _outermost(paths)]
    missing = [source.relative_to(trash_dir).as_posix() for source, _ in moves if not source.exists()]
    if missing:
        raise ArchiveNotFoundError(f"ゴミ箱に見つかりません（{archive_name}）: {', '.join(missing)}")
    try:
        for source, dest in moves:
            _remove(dest)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(dest))
        _prune_empty_dirs(trash_dir)
        if trash_dir.is_dir() and not any(trash_dir.iterdir()):
            trash_dir.rmdir()
    except OSError as e:
        raise ArchiveServiceError("ファイルを元に戻せませんでした。", raw_response=exception_text(e)) from e


def restore_archive(archive_name: str) -> None:
    """Moves an archive back from ``.trash`` (replacing any folder with the same name)."""
    validate_archive_name(archive_name)
    trash_path = settings.trash_dir / archive_name
    if not trash_path.exists():
        raise ArchiveNotFoundError(f"ゴミ箱にアーカイブ「{archive_name}」が見つかりません。")
    dest_path = settings.archives_dir / archive_name
    try:
        _remove(dest_path)
        shutil.move(str(trash_path), str(dest_path))
    except OSError as e:
        raise ArchiveServiceError("アーカイブを元に戻せませんでした。", raw_response=exception_text(e)) from e


def empty_trash() -> list[str]:
    """Permanently removes everything in ``.trash`` (called on backend startup).

    Entries that cannot be removed (e.g. a file locked by another program) are logged and
    left in place; returns their names.
    """
    trash_dir = settings.trash_dir
    if not trash_dir.is_dir():
        return []
    failed: list[str] = []
    for entry in trash_dir.iterdir():
        try:
            _remove(entry)
        except OSError as e:
            logger.warning("Could not empty trash entry %s: %s", entry, exception_text(e))
            failed.append(entry.name)
    return failed
