"""Folder-based archive storage.

Layout (under ``settings.archives_dir``)::

    <archive>/                       top-level folder, e.g. "20260101_100000_image"
        <file or sub/dir>
    .trash/<archive>/                deleted archives (restore_archive)
    .trash/.items/<archive>/<path>   files / sub-folders deleted from an archive (restore_archive_contents)

The frontend addresses entries with keys of the form ``"<archive>/<relative path>"``.
Every path is resolved through ``resolve_path`` which rejects traversal outside the
archive folder. Archive names starting with "." are reserved for these folders.
"""

import os
import shutil
from pathlib import Path
from typing import Literal, NotRequired, TypedDict

from ..config import settings
from ..errors import AppError, BadRequestError, NotFoundError

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
        raise ArchiveValidationError(f"Invalid archive name: {name}")


def _resolve_inside(base_dir: Path, relative_path: str) -> Path:
    target = (base_dir / normalize_rel_path(relative_path)).resolve()
    if target == base_dir or not target.is_relative_to(base_dir):
        raise ArchiveValidationError("Path traversal detected")
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
        raise ArchiveNotFoundError(f"Archive '{archive_name}' not found")
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
        raise ArchiveNotFoundError(f"File '{path}' not found in archive '{archive_name}'")
    try:
        content = target.read_bytes()
    except OSError as e:
        raise ArchiveServiceError(str(e)) from e
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
        raise ArchiveServiceError(f"Failed to save archive: {e}") from e
    return name


def append_archive_log(archive_name: str, message: str, file_name: str = "log.txt") -> None:
    """Appends ``message`` (newline-terminated) to a log file at the archive root."""
    _existing_archive_dir(archive_name)
    log_file = resolve_path(archive_name, file_name)
    if not message.endswith("\n"):
        message += "\n"
    try:
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(message)
    except OSError as e:
        raise ArchiveServiceError(f"Failed to append to log: {e}") from e


def delete_archive(archive_name: str) -> None:
    """Moves an archive into ``.trash`` (replacing an older trashed copy)."""
    archive_dir = _existing_archive_dir(archive_name)
    trash_target = settings.trash_dir / archive_name
    try:
        settings.trash_dir.mkdir(parents=True, exist_ok=True)
        _remove(trash_target)
        shutil.move(str(archive_dir), str(trash_target))
    except OSError as e:
        raise ArchiveServiceError(str(e)) from e


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
        raise ArchiveServiceError(f"Failed to delete archive contents: {e}") from e


def restore_archive_contents(archive_name: str, paths: list[str]) -> None:
    """Moves files/sub-folders back from ``.trash/.items/<archive>/`` to their original paths.

    Recreates the archive folder if it was removed; anything now at those paths is replaced.
    """
    trash_dir = _item_trash_dir(archive_name)
    moves = [(_resolve_inside(trash_dir, p), resolve_path(archive_name, p)) for p in _outermost(paths)]
    missing = [source.relative_to(trash_dir).as_posix() for source, _ in moves if not source.exists()]
    if missing:
        raise ArchiveNotFoundError(f"Not found in trash of '{archive_name}': {', '.join(missing)}")
    try:
        for source, dest in moves:
            _remove(dest)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(dest))
        _prune_empty_dirs(trash_dir)
        if trash_dir.is_dir() and not any(trash_dir.iterdir()):
            trash_dir.rmdir()
    except OSError as e:
        raise ArchiveServiceError(f"Failed to restore archive contents: {e}") from e


def restore_archive(archive_name: str) -> None:
    """Moves an archive back from ``.trash`` (replacing any folder with the same name)."""
    validate_archive_name(archive_name)
    trash_path = settings.trash_dir / archive_name
    if not trash_path.exists():
        raise ArchiveNotFoundError(f"Archive '{archive_name}' not found in trash")
    dest_path = settings.archives_dir / archive_name
    try:
        _remove(dest_path)
        shutil.move(str(trash_path), str(dest_path))
    except OSError as e:
        raise ArchiveServiceError(str(e)) from e
