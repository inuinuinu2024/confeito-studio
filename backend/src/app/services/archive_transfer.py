"""Archive export / import as zip files (docs/specs/archives.md 「エクスポート / インポート」).

Export layout::

    manifest.json               {"format": "confeito-archives", "version": 1,
                                 "archives": [{"id", "name", "created_at", "folder_mtimes": {<sub folder>: <mtime>}}]}
    <id>/.archive.json          the display name (written from ``read_meta`` when the archive has none)
    <id>/<every file of the archive folder>

Import reads that layout, a zip of archive folders without manifest.json (the contents of an archives/
folder), or a zip with files at its top (one archive named after the zip). Every archive becomes a new
one: an id (folder name) or display name in use gets "_2" / " (2)" ..., nothing is overwritten. Each
archive is extracted into a hidden ``.import-*`` folder first and moved into place when complete.
When the id changes, the archive keys inside info.json (source, sources, settings) and .flow.json ("<id>/<path>")
are rewritten.
The sub-folders get back their modification times from the manifest (a result folder without info.json is
dated by it); the archive folder itself is dated by the import, so imported archives come first in the list.
"""

import json
import os
import re
import shutil
import tempfile
import uuid
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import IO, Any, TypedDict

from ..config import settings
from ..errors import AppError, exception_text
from . import archive_service as svc
from .json_file import read_json_object

MANIFEST = "manifest.json"
FORMAT = "confeito-archives"
STORED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
"""Already compressed: stored as they are (deflating them only costs time)."""
_UNSAFE_FILE_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


class ImportedArchive(TypedDict):
    key: str
    name: str


@dataclass
class ImportResult:
    imported: list[ImportedArchive] = field(default_factory=list)
    skipped_files: int = 0
    warnings: list[str] = field(default_factory=list)


def safe_file_name(name: str) -> str:
    """``name`` usable as a file name (characters Windows refuses become "_")."""
    return _UNSAFE_FILE_CHARS.sub("_", name).strip(" .") or "archive"


def _stamp(now: datetime | None = None) -> str:
    return f"{now or datetime.now():%Y%m%d_%H%M%S}"


def export_file_name(display_names: list[str], now: datetime | None = None) -> str:
    """confeito-archive-<name>-<stamp>.zip for one archive, confeito-archives-<stamp>.zip for several."""
    if len(display_names) == 1:
        return f"confeito-archive-{safe_file_name(display_names[0])}-{_stamp(now)}.zip"
    return f"confeito-archives-{_stamp(now)}.zip"


# ── Export ────────────────────────────────────────────────────────────


def _unique_ids(names: list[str]) -> list[str]:
    ids = list(dict.fromkeys(names))
    if not ids:
        raise svc.ArchiveValidationError("書き出すアーカイブが選ばれていません。")
    return ids


def _folder_mtimes(archive_dir: Path) -> dict[str, float]:
    """Modification time of every sub-folder (path in the archive)."""
    return {
        path.relative_to(archive_dir).as_posix(): path.stat().st_mtime
        for path in sorted(archive_dir.rglob("*"))
        if path.is_dir()
    }


def export_archives(names: list[str], dest: Path, now: datetime | None = None) -> str:
    """Writes the archives ``names`` (ids) as a zip to ``dest``; returns the file name for the download."""
    ids = _unique_ids(names)
    dirs = [svc.existing_archive_dir(name) for name in ids]
    metas = [svc.read_meta(name) for name in ids]
    manifest = {
        "format": FORMAT,
        "version": 1,
        "exported_at": f"{now or datetime.now():%Y-%m-%d %H:%M:%S}",
        "archives": [
            {"id": i, **m, "folder_mtimes": _folder_mtimes(d)} for i, m, d in zip(ids, metas, dirs, strict=True)
        ],
    }
    try:
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=2))
            for archive_id, archive_dir, meta in zip(ids, dirs, metas, strict=True):
                if not (archive_dir / svc.ARCHIVE_META_FILE).is_file():
                    zf.writestr(f"{archive_id}/{svc.ARCHIVE_META_FILE}", svc.meta_bytes(meta))
                for root, _dirs, files in os.walk(archive_dir):
                    for file_name in sorted(files):
                        path = Path(root) / file_name
                        arcname = f"{archive_id}/{path.relative_to(archive_dir).as_posix()}"
                        stored = path.suffix.lower() in STORED_SUFFIXES
                        zf.write(path, arcname, compress_type=zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED)
    except OSError as e:
        raise svc.ArchiveServiceError("アーカイブを書き出せませんでした。", raw_response=exception_text(e)) from e
    return export_file_name([m["name"] for m in metas], now)


# ── Images (the work to use outside the app) ──────────────────────────


def image_file_name(key: str) -> str:
    """The name an image is written as: a page keeps its name, a result gets its folder ("<folder>_<name>")."""
    _archive, rel = svc.split_archive_path(key)
    return safe_file_name(rel.replace("/", "_"))


def _numbered(name: str, taken: set[str]) -> str:
    """``name``, or ``<stem>_2<suffix>`` ... when it is in ``taken``."""
    path = PurePosixPath(name)
    candidate, n = name, 1
    while candidate in taken:
        n += 1
        candidate = f"{path.stem}_{n}{path.suffix}"
    return candidate


def export_images(keys: list[str], dest: Path, now: datetime | None = None) -> str:
    """Writes the images ``keys`` side by side (no folders) as a zip to ``dest``; returns the download name."""
    keys = list(dict.fromkeys(keys))
    if not keys:
        raise svc.ArchiveValidationError("書き出す画像が選ばれていません。")
    sources: list[tuple[Path, str]] = []
    taken: set[str] = set()
    for key in keys:
        archive, rel = svc.split_archive_path(key)
        path = svc.resolve_path(archive, rel) if rel else None
        if path is None or not path.is_file():
            raise svc.ArchiveNotFoundError(f"画像「{key}」が見つかりません。")
        name = _numbered(image_file_name(key), taken)
        taken.add(name)
        sources.append((path, name))
    try:
        with zipfile.ZipFile(dest, "w") as zf:
            for path, name in sources:
                zf.write(path, name, compress_type=zipfile.ZIP_STORED)
    except OSError as e:
        raise svc.ArchiveServiceError("画像を書き出せませんでした。", raw_response=exception_text(e)) from e
    return f"confeito-images-{_stamp(now)}.zip"


def to_temp(write: Callable[[Path], str]) -> tuple[Path, str]:
    """Runs ``write`` into a temp file (the caller deletes it); returns its path and the download name."""
    fd, temp = tempfile.mkstemp(prefix="confeito-export-", suffix=".zip")
    os.close(fd)
    path = Path(temp)
    try:
        return path, write(path)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


# ── Import ────────────────────────────────────────────────────────────


@dataclass
class _Group:
    """One archive found in the zip: its id there, what the manifest says and its files (path in the archive)."""

    source_id: str
    name: str | None = None
    created_at: str | None = None
    folder_mtimes: dict[str, float] = field(default_factory=dict)
    members: list[tuple[str, zipfile.ZipInfo]] = field(default_factory=list)


def _clean_member_path(name: str) -> str | None:
    """The member's path with "/" separators, or None when it could point outside (absolute, "..", drive)."""
    path = name.replace("\\", "/")
    if path.startswith("/") or re.match(r"^[A-Za-z]:", path):
        return None
    parts = PurePosixPath(path).parts
    if not parts or any(p in ("..", "") for p in parts):
        return None
    return "/".join(parts)


def _read_manifest(zf: zipfile.ZipFile) -> list[dict[str, Any]] | None:
    try:
        data = json.loads(zf.read(MANIFEST).decode("utf-8"))
    except (KeyError, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict) or data.get("format") != FORMAT or not isinstance(data.get("archives"), list):
        return None
    return [a for a in data["archives"] if isinstance(a, dict) and isinstance(a.get("id"), str) and a["id"]]


def _text(data: dict[str, Any], key: str) -> str | None:
    value = data.get(key)
    return value if isinstance(value, str) else None


def _mtimes(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    return {k: float(v) for k, v in value.items() if isinstance(k, str) and isinstance(v, int | float)}


def _restore_folder_mtimes(temp_dir: Path, mtimes: dict[str, float]) -> None:
    """Dates the extracted sub-folders as in the exported archive (deepest first; unknown paths are ignored)."""
    root = temp_dir.resolve()
    for rel in sorted(mtimes, key=lambda r: r.count("/"), reverse=True):
        clean = _clean_member_path(rel)
        folder = (root / clean).resolve() if clean else None
        if folder is None or not folder.is_relative_to(root) or folder == root or not folder.is_dir():
            continue
        try:
            os.utime(folder, (mtimes[rel], mtimes[rel]))
        except (OSError, OverflowError, ValueError):
            continue


def _groups(zf: zipfile.ZipFile, zip_name: str, result: ImportResult) -> list[_Group]:
    """The archives in the zip (see the module docstring for the layouts read)."""
    files: list[tuple[str, zipfile.ZipInfo]] = []
    for info in zf.infolist():
        if info.is_dir() or info.filename.startswith("__MACOSX/"):
            continue
        path = _clean_member_path(info.filename)
        if path is None:
            result.skipped_files += 1
            continue
        files.append((path, info))

    manifest = _read_manifest(zf)
    if manifest is not None:
        groups = {
            a["id"]: _Group(a["id"], _text(a, "name"), _text(a, "created_at"), _mtimes(a.get("folder_mtimes")))
            for a in manifest
        }
    elif any("/" not in path for path, _ in files):
        # Files at the top: the whole zip is one archive named after the zip file.
        stem = Path(zip_name).stem or "archive"
        group = _Group(safe_file_name(stem), stem)
        group.members = [(path, info) for path, info in files]
        return [group]
    else:
        groups = {}

    for path, info in files:
        top, _, rest = path.partition("/")
        if path == MANIFEST or not rest:
            continue
        if manifest is None and top.startswith("."):
            continue  # .trash and other app folders of an archives/ folder
        group = groups.get(top) if manifest is not None else groups.setdefault(top, _Group(top))
        if group is None:
            result.skipped_files += 1
            continue
        group.members.append((rest, info))
    return [g for g in groups.values() if g.members]


_KEY_PREFIX = r"(^|\|){}/"


def _rewrite(value: Any, old: str, new: str) -> Any:
    """``value`` with archive keys "<old>/..." (also inside stack ids "<key>|<tool>", "|<tool>|<key>") moved to ``new``."""
    if isinstance(value, str):
        return re.sub(_KEY_PREFIX.format(re.escape(old)), lambda m: f"{m.group(1)}{new}/", value)
    if isinstance(value, list):
        return [_rewrite(v, old, new) for v in value]
    if isinstance(value, dict):
        return {_rewrite(k, old, new): _rewrite(v, old, new) for k, v in value.items()}
    return value


def _rewrite_json(path: Path, fields: tuple[str, ...], old: str, new: str) -> None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return  # unreadable: left as it is (the flow shows it like any broken file)
    if not isinstance(data, dict):
        return
    for name in fields:
        if name in data:
            data[name] = _rewrite(data[name], old, new)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _rewrite_keys(archive_dir: Path, old: str, new: str) -> None:
    """Points the keys stored in the archive at its new id ``new``."""
    for info in archive_dir.rglob(svc.RESULT_INFO_FILE):
        _rewrite_json(info, ("source", "sources", "settings"), old, new)
    flow = archive_dir / svc.FLOW_FILE
    if flow.is_file():
        _rewrite_json(flow, ("selection", "merge"), old, new)


def _free_id(source_id: str) -> str:
    """``source_id`` as a valid archive id that is not in use ("_2" ...)."""
    candidate = safe_file_name(source_id)
    try:
        svc.validate_archive_name(candidate)
    except svc.ArchiveValidationError:
        candidate = "archive"
    return svc.unique_name(settings.archives_dir, candidate)


def _display_name(temp_dir: Path, group: _Group) -> tuple[str, str]:
    """The name (made unique) and creation time of an imported archive: its .archive.json, else the manifest's."""
    data = read_json_object(temp_dir / svc.ARCHIVE_META_FILE) or {}
    name = (_text(data, "name") or "").strip() or group.name
    created_at = _text(data, "created_at") or group.created_at
    meta = svc.new_archive_meta(name or group.source_id)
    return meta["name"], created_at or meta["created_at"]


def _import_group(zf: zipfile.ZipFile, group: _Group, result: ImportResult) -> ImportedArchive:
    archives_dir = settings.archives_dir
    temp_dir = archives_dir / f".import-{uuid.uuid4().hex}"
    try:
        temp_dir.mkdir(parents=True)
        for rel, info in group.members:
            target = (temp_dir / rel).resolve()
            if not target.is_relative_to(temp_dir.resolve()):
                result.skipped_files += 1
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
        name, created_at = _display_name(temp_dir, group)
        svc.write_meta(temp_dir, {"name": name, "created_at": created_at})
        new_id = _free_id(group.source_id)
        if new_id != group.source_id:
            _rewrite_keys(temp_dir, group.source_id, new_id)
        _restore_folder_mtimes(temp_dir, group.folder_mtimes)
        temp_dir.rename(archives_dir / new_id)
    except BaseException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    return {"key": new_id, "name": name}


def import_zip(file: IO[bytes], zip_name: str) -> ImportResult:
    """Adds every archive in the zip as a new archive (nothing existing is changed)."""
    try:
        zf = zipfile.ZipFile(file)
    except (zipfile.BadZipFile, OSError) as e:
        raise svc.ArchiveValidationError("zip として読めないファイルです。", raw_response=exception_text(e)) from e
    result = ImportResult()
    with zf:
        groups = _groups(zf, zip_name, result)
        if not groups:
            raise svc.ArchiveValidationError("zip に読み込めるアーカイブがありません。", raw_response=zip_name)
        failures: list[Exception] = []
        for group in groups:
            try:
                result.imported.append(_import_group(zf, group, result))
            except (OSError, zipfile.BadZipFile, AppError) as e:
                failures.append(e)
                result.warnings.append(
                    f"「{group.name or group.source_id}」を読み込めませんでした: {exception_text(e)}"
                )
    if not result.imported:
        raise svc.ArchiveServiceError(
            "アーカイブを読み込めませんでした。", raw_response="\n".join(result.warnings) or zip_name
        ) from (failures[0] if failures else None)
    if result.skipped_files:
        result.warnings.append(f"読み込めなかったファイル {result.skipped_files} 件は外しました。")
    return result
