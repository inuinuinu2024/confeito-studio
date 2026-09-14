import os
import shutil
import zipfile
from pathlib import Path
from typing import List, Dict, Any, Tuple

PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
ARCHIVES_DIR = PROJECT_ROOT / "archives"
TRASH_DIR = ARCHIVES_DIR / ".trash"

# Ensure archives directory exists
ARCHIVES_DIR.mkdir(parents=True, exist_ok=True)
TRASH_DIR.mkdir(parents=True, exist_ok=True)


class ArchiveServiceError(Exception):
    pass


class ArchiveNotFoundError(ArchiveServiceError):
    pass


class ArchiveValidationError(ArchiveServiceError):
    pass


def _validate_name(name: str) -> None:
    if not name or ".." in name or "/" in name or "\\" in name:
        raise ArchiveValidationError(f"Invalid archive name: {name}")


def _safe_resolve(archive_name: str, relative_path: str = "") -> Path:
    _validate_name(archive_name)
    base_dir = (ARCHIVES_DIR / archive_name).resolve()
    if relative_path:
        target_path = (base_dir / relative_path).resolve()
    else:
        target_path = base_dir

    try:
        target_path.relative_to(ARCHIVES_DIR.resolve())
    except ValueError:
        raise ArchiveValidationError("Path traversal detected")

    return target_path


def migrate_existing_zips() -> None:
    """Migrate legacy .zip archives into standard directory folders."""
    for zip_path in ARCHIVES_DIR.glob("*.zip"):
        folder_name = zip_path.stem
        folder_path = ARCHIVES_DIR / folder_name

        try:
            folder_path.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zip_path, "r") as zf:
                for member in zf.infolist():
                    # Handle encoding for Japanese filenames
                    filename = member.filename
                    try:
                        filename = filename.encode('cp437').decode('utf-8')
                    except Exception:
                        try:
                            filename = filename.encode('cp437').decode('cp932')
                        except Exception:
                            pass

                    target_file = folder_path / filename
                    if member.is_dir():
                        target_file.mkdir(parents=True, exist_ok=True)
                    else:
                        target_file.parent.mkdir(parents=True, exist_ok=True)
                        target_file.write_bytes(zf.read(member.filename))

            # Move original zip to trash or remove
            trash_zip = TRASH_DIR / zip_path.name
            if trash_zip.exists():
                trash_zip.unlink()
            zip_path.rename(trash_zip)
            print(f"[ArchiveService] Migrated {zip_path.name} to folder {folder_name}")
        except Exception as e:
            print(f"[ArchiveService] Failed to migrate {zip_path.name}: {e}")


def save_archive(name: str, files_data: List[Tuple[str, bytes]]) -> str:
    """Save or append files to a directory-based archive."""
    _validate_name(name)
    archive_dir = _safe_resolve(name)
    archive_dir.mkdir(parents=True, exist_ok=True)

    try:
        for rel_path, content in files_data:
            clean_rel = rel_path.replace("\\", "/").lstrip("/")
            target_file = _safe_resolve(name, clean_rel)
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_bytes(content)

        return name
    except Exception as e:
        raise ArchiveServiceError(f"Failed to save archive: {str(e)}")


def list_archives() -> List[Dict[str, Any]]:
    """List all folder-based archives."""
    migrate_existing_zips()

    archives = []
    if not ARCHIVES_DIR.exists():
        return archives

    for item in sorted(ARCHIVES_DIR.iterdir(), key=os.path.getmtime, reverse=True):
        if not item.is_dir() or item.name.startswith("."):
            continue

        archive_name = item.name
        timestamp = int(item.stat().st_mtime * 1000)

        archives.append({
            "key": archive_name,
            "name": archive_name,
            "type": "folder",
            "folderId": None,
            "timestamp": timestamp,
            "collapsed": True
        })

    return archives


def list_archive_contents(archive_name: str) -> List[Dict[str, Any]]:
    """List hierarchical contents of a specific folder archive."""
    archive_dir = _safe_resolve(archive_name)
    if not archive_dir.exists() or not archive_dir.is_dir():
        raise ArchiveNotFoundError(f"Archive '{archive_name}' not found")

    archives = []
    timestamp = int(archive_dir.stat().st_mtime * 1000)
    added_folders = set()

    for root, dirs, files in os.walk(archive_dir):
        rel_root = os.path.relpath(root, archive_dir).replace("\\", "/")

        if rel_root != ".":
            path_parts = rel_root.split("/")
            current_path = ""
            for i, part in enumerate(path_parts):
                parent_folder_id = f"{archive_name}/{current_path}" if current_path else archive_name
                current_path = f"{current_path}/{part}" if current_path else part
                folder_key = f"{archive_name}/{current_path}"

                if folder_key not in added_folders:
                    archives.append({
                        "key": folder_key,
                        "name": part,
                        "type": "folder",
                        "folderId": parent_folder_id,
                        "timestamp": timestamp,
                        "collapsed": False
                    })
                    added_folders.add(folder_key)

        for file_name in files:
            file_rel_path = f"{rel_root}/{file_name}" if rel_root != "." else file_name
            parent_folder_id = f"{archive_name}/{rel_root}" if rel_root != "." else archive_name

            archives.append({
                "key": f"{archive_name}/{file_rel_path}",
                "name": file_name,
                "type": "image",
                "folderId": parent_folder_id,
                "timestamp": timestamp,
                "blob": None
            })

    return archives


def extract_file(archive_name: str, path: str) -> Tuple[bytes, str]:
    """Read a specific file from a folder archive."""
    clean_path = path.replace("\\", "/").lstrip("/")
    target_file = _safe_resolve(archive_name, clean_path)

    if not target_file.exists() or not target_file.is_file():
        raise ArchiveNotFoundError(f"File '{path}' not found in archive '{archive_name}'")

    try:
        content = target_file.read_bytes()

        mime_type = "application/octet-stream"
        lower_path = clean_path.lower()
        if lower_path.endswith(".png"):
            mime_type = "image/png"
        elif lower_path.endswith(".jpg") or lower_path.endswith(".jpeg"):
            mime_type = "image/jpeg"
        elif lower_path.endswith(".webp"):
            mime_type = "image/webp"
        elif lower_path.endswith(".gif"):
            mime_type = "image/gif"
        elif lower_path.endswith(".json"):
            mime_type = "application/json"
        elif lower_path.endswith(".txt") or lower_path.endswith(".md"):
            mime_type = "text/plain"

        return content, mime_type
    except Exception as e:
        raise ArchiveServiceError(str(e))


def delete_archive(archive_name: str) -> None:
    """Move a folder archive to the trash directory."""
    archive_dir = _safe_resolve(archive_name)
    if not archive_dir.exists() or not archive_dir.is_dir():
        raise ArchiveNotFoundError(f"Archive '{archive_name}' not found")

    try:
        trash_target = TRASH_DIR / archive_name
        if trash_target.exists():
            if trash_target.is_dir():
                shutil.rmtree(trash_target)
            else:
                trash_target.unlink()

        shutil.move(str(archive_dir), str(trash_target))
    except Exception as e:
        raise ArchiveServiceError(str(e))


def delete_archive_contents(archive_name: str, paths: List[str]) -> None:
    """Delete specific files or subdirectories from a folder archive."""
    archive_dir = _safe_resolve(archive_name)
    if not archive_dir.exists() or not archive_dir.is_dir():
        raise ArchiveNotFoundError(f"Archive '{archive_name}' not found")

    try:
        for p in paths:
            clean_p = p.replace("\\", "/").lstrip("/")
            target = _safe_resolve(archive_name, clean_p)
            if target.exists():
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()

        # Clean up empty parent directories
        for root, dirs, files in os.walk(archive_dir, topdown=False):
            if root != str(archive_dir):
                if not os.listdir(root):
                    os.rmdir(root)

        # If archive directory is now empty, move it to trash
        if not any(archive_dir.iterdir()):
            delete_archive(archive_name)
    except Exception as e:
        raise ArchiveServiceError(f"Failed to delete archive contents: {str(e)}")


def restore_archive(archive_name: str) -> None:
    """Restore a deleted folder archive from trash."""
    _validate_name(archive_name)
    trash_path = TRASH_DIR / archive_name
    if not trash_path.exists():
        raise ArchiveNotFoundError(f"Archive '{archive_name}' not found in trash")

    try:
        dest_path = ARCHIVES_DIR / archive_name
        if dest_path.exists():
            if dest_path.is_dir():
                shutil.rmtree(dest_path)
            else:
                dest_path.unlink()

        shutil.move(str(trash_path), str(dest_path))
    except Exception as e:
        raise ArchiveServiceError(str(e))


def append_archive_log(archive_name: str, message: str) -> None:
    """Append a log line to log.txt inside a folder archive."""
    archive_dir = _safe_resolve(archive_name)
    if not archive_dir.exists() or not archive_dir.is_dir():
        raise ArchiveNotFoundError(f"Archive '{archive_name}' not found")

    try:
        log_file = archive_dir / "log.txt"
        if not message.endswith("\n"):
            message += "\n"

        with open(log_file, "a", encoding="utf-8") as f:
            f.write(message)
    except Exception as e:
        raise ArchiveServiceError(f"Failed to append to log: {str(e)}")

