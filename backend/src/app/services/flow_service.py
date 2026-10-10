"""The processing flow of one archive, read for the Normal mode canvas (docs/specs/flow-canvas.md).

* roots: images directly in the archive folder (the imported pages).
* runs:  every direct sub-folder holding images is one tool run, described by its info.json
  (``archive_service.save_result``). A folder without a readable info.json still shows its images,
  as a run with no input whose tool name is taken from the folder name.
* selection: which run of each stack (same input + same tool) the canvas shows, kept in
  ``<archive>/.flow.json`` (``{"selection": {stackId: run folder key}}``).
* merge: the image the user marked for each panel of a コマ分割, pasted by コマ結合 instead of the newest one
  (``{"merge": {panel image key: image key}}`` in the same file).

Thumbnails of the cells are made here too, so large pages are not sent in full for every cell.
"""

import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any, TypedDict

from PIL import Image

from ..config import settings as app_settings
from ..errors import exception_text
from .archive_service import (
    FLOW_FILE,
    RESULT_INFO_FILE,
    ArchiveNotFoundError,
    ArchiveServiceError,
    ArchiveValidationError,
    existing_archive_dir,
    read_meta,
    resolve_path,
)
from .json_file import read_json_object, write_json_atomic

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
THUMBNAIL_MIN, THUMBNAIL_MAX = 32, 1024

_STAMP_PREFIX = re.compile(r"^\d{8}_\d{6}_")
_COPY_SUFFIX = re.compile(r"_\d+$")


class FlowImage(TypedDict):
    key: str
    name: str
    width: int | None
    height: int | None


class FlowRun(TypedDict):
    folder: str
    tool: str
    created_at: str
    source: str | None
    sources: list[str]
    settings: dict[str, Any]
    outputs: list[FlowImage]


class ArchiveSummary(TypedDict):
    """One row of the Archive Manager (``timestamp``: last modified, ms)."""

    key: str
    name: str
    created_at: str
    timestamp: int
    images: int
    results: int
    size: int
    cover: str | None


class Flow(TypedDict):
    archive: str
    roots: list[FlowImage]
    runs: list[FlowRun]
    selection: dict[str, str]
    merge: dict[str, str]


def is_image(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES


def _image(archive_name: str, path: Path, rel: str) -> FlowImage:
    width = height = None
    try:
        with Image.open(path) as img:  # reads the header only
            width, height = img.size
    except Exception:  # noqa: BLE001 — an unreadable image still gets a cell
        pass
    return {"key": f"{archive_name}/{rel}", "name": path.name, "width": width, "height": height}


def _tool_from_folder(name: str) -> str:
    """``20261004_154254_背景除去_2`` -> ``背景除去``."""
    return _COPY_SUFFIX.sub("", _STAMP_PREFIX.sub("", name)) or name


def _run(archive_name: str, folder: Path) -> FlowRun | None:
    images = sorted((p for p in folder.iterdir() if is_image(p)), key=lambda p: p.name)
    if not images:
        return None
    info = read_json_object(folder / RESULT_INFO_FILE) if (folder / RESULT_INFO_FILE).is_file() else None
    info = info or {}
    tool = info.get("tool") if isinstance(info.get("tool"), str) else _tool_from_folder(folder.name)

    # The order of info.json "outputs" (01.png, 02.png ...), then images it does not list.
    listed = [o for o in info.get("outputs") or [] if isinstance(o, str) and "/" not in o]
    by_name = {p.name: p for p in images}
    ordered = [by_name.pop(name) for name in listed if name in by_name] + list(by_name.values())

    source = info.get("source") if isinstance(info.get("source"), str) else None
    sources = [s for s in info.get("sources") or [] if isinstance(s, str)]
    created_at = info.get("created_at")
    if not isinstance(created_at, str):
        created_at = f"{datetime.fromtimestamp(folder.stat().st_mtime):%Y-%m-%d %H:%M:%S}"
    settings = info.get("settings") if isinstance(info.get("settings"), dict) else {}
    return {
        "folder": f"{archive_name}/{folder.name}",
        "tool": tool,
        "created_at": created_at,
        "source": source,
        "sources": sources,
        "settings": settings,
        "outputs": [_image(archive_name, p, f"{folder.name}/{p.name}") for p in ordered],
    }


def _read_map(archive_dir: Path, field: str) -> dict[str, str]:
    """A ``{str: str}`` object of .flow.json (``{}`` when the file or the field is missing or broken)."""
    data = read_json_object(archive_dir / FLOW_FILE) or {}
    value = data.get(field)
    if not isinstance(value, dict):
        return {}
    return {k: v for k, v in value.items() if isinstance(k, str) and isinstance(v, str)}


def _set_entry(archive_name: str, field: str, key: str, value: str | None, error_message: str) -> None:
    """Sets (or with None removes) ``key`` of the ``field`` object of .flow.json, keeping everything else."""
    archive_dir = existing_archive_dir(archive_name)
    path = archive_dir / FLOW_FILE
    data = read_json_object(path) or {}
    entries = _read_map(archive_dir, field)
    if value:
        entries[key] = value
    else:
        entries.pop(key, None)
    write_json_atomic(path, {**data, field: entries}, error_message)


def get_flow(archive_name: str) -> Flow:
    """Roots, runs (oldest first) and the shown run of each stack of ``archive_name``."""
    archive_dir = existing_archive_dir(archive_name)
    entries = sorted(archive_dir.iterdir(), key=lambda p: p.name)
    roots = [_image(archive_name, p, p.name) for p in entries if is_image(p)]
    runs = [
        run for p in entries if p.is_dir() and not p.name.startswith(".") and (run := _run(archive_name, p)) is not None
    ]
    runs.sort(key=lambda r: (r["created_at"], r["folder"]))
    return {
        "archive": archive_name,
        "roots": roots,
        "runs": runs,
        "selection": _read_map(archive_dir, "selection"),
        "merge": _read_map(archive_dir, "merge"),
    }


def _summary(archive_dir: Path) -> ArchiveSummary:
    name = archive_dir.name
    entries = sorted(archive_dir.iterdir(), key=lambda p: p.name)
    roots = [p.name for p in entries if is_image(p)]
    runs = [
        (p.name, images)
        for p in entries
        if p.is_dir() and not p.name.startswith(".") and (images := sorted(c.name for c in p.iterdir() if is_image(c)))
    ]
    size = sum(f.stat().st_size for f in archive_dir.rglob("*") if f.is_file())
    cover = f"{name}/{roots[0]}" if roots else f"{name}/{runs[0][0]}/{runs[0][1][0]}" if runs else None
    meta = read_meta(name)
    return {
        "key": name,
        "name": meta["name"],
        "created_at": meta["created_at"],
        "timestamp": int(archive_dir.stat().st_mtime * 1000),
        "images": len(roots) + sum(len(images) for _, images in runs),
        "results": len(runs),
        "size": size,
        "cover": cover,
    }


def archive_summaries() -> list[ArchiveSummary]:
    """Every archive with what the Archive Manager lists, newest first (same order as ``list_archives``).

    The images and results counted are those the Workspace shows (images directly in the archive and in
    its result folders); the size is every file. An archive that cannot be read (removed meanwhile) is left out.
    """
    root = app_settings.archives_dir
    if not root.is_dir():
        return []
    result: list[ArchiveSummary] = []
    for folder in root.iterdir():
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        try:
            result.append(_summary(folder))
        except (OSError, ArchiveNotFoundError):
            continue
    result.sort(key=lambda s: s["timestamp"], reverse=True)
    return result


def set_selection(archive_name: str, stack: str, folder: str | None) -> None:
    """Records ``folder`` as the shown run of ``stack`` (None forgets it: the newest run is shown)."""
    if not stack:
        raise ArchiveValidationError("候補のまとまり（stack）が指定されていません。")
    _set_entry(archive_name, "selection", stack, folder, "表示する候補を保存できませんでした。")


def set_merge_choice(archive_name: str, panel: str, image: str | None) -> None:
    """Marks ``image`` as what コマ結合 pastes for ``panel`` (None: back to the newest image)."""
    if not panel:
        raise ArchiveValidationError("コマ（panel）が指定されていません。")
    _set_entry(archive_name, "merge", panel, image, "コマ結合に使う画像の指定を保存できませんでした。")


def thumbnail(archive_name: str, path: str, size: int) -> tuple[bytes, str]:
    """A copy of the image at most ``size`` px on its long side (PNG with alpha, JPEG otherwise)."""
    target = resolve_path(archive_name, path)
    if not is_image(target):
        raise ArchiveNotFoundError(f"アーカイブ「{archive_name}」に画像 {path} が見つかりません。")
    size = max(THUMBNAIL_MIN, min(THUMBNAIL_MAX, size))
    try:
        with Image.open(target) as img:
            img.thumbnail((size, size))
            has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
            out = img.convert("RGBA" if has_alpha else "RGB")
        buf = io.BytesIO()
        if has_alpha:
            out.save(buf, format="PNG")
            return buf.getvalue(), "image/png"
        out.save(buf, format="JPEG", quality=85)
        return buf.getvalue(), "image/jpeg"
    except OSError as e:
        raise ArchiveServiceError(f"サムネイルを作れませんでした: {path}", raw_response=exception_text(e)) from e
