import os
import zipfile
from pathlib import Path
from typing import List, Dict, Any, Tuple

PROJECT_ROOT = Path(__file__).parent.parent.parent.parent.parent
ARCHIVES_DIR = PROJECT_ROOT / "archives"

# Ensure archives directory exists
ARCHIVES_DIR.mkdir(parents=True, exist_ok=True)

class ArchiveServiceError(Exception):
    pass

class ArchiveNotFoundError(ArchiveServiceError):
    pass

class ArchiveValidationError(ArchiveServiceError):
    pass

def save_archive(name: str, files_data: List[Tuple[str, bytes]]) -> str:
    if not name or ".." in name or "/" in name or "\\" in name:
        raise ArchiveValidationError("Invalid archive name")
    
    zip_path = ARCHIVES_DIR / f"{name}.zip"
    
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for path, content in files_data:
                zf.writestr(path, content)
        return f"{name}.zip"
    except Exception as e:
        if zip_path.exists():
            zip_path.unlink()
        raise ArchiveServiceError(f"Failed to create archive: {str(e)}")

def list_archives() -> List[Dict[str, Any]]:
    archives = []
    
    for file_path in sorted(ARCHIVES_DIR.glob("*.zip"), key=os.path.getmtime, reverse=True):
        zip_name = file_path.name
        archive_name = file_path.stem
        timestamp = int(file_path.stat().st_mtime * 1000)
        
        # Add the root zip folder
        archives.append({
            "key": zip_name,
            "name": archive_name,
            "type": "folder",
            "folderId": None,
            "timestamp": timestamp,
            "collapsed": False
        })
        
        try:
            with zipfile.ZipFile(file_path, "r") as zf:
                info_list = zf.infolist()
                
                # We need to map directories to 'folder' items as well
                # Some zip files don't have explicit directory entries, so we must infer them
                added_folders = set()
                
                for info in info_list:
                    path_parts = info.filename.rstrip("/").split("/")
                    
                    # Ensure intermediate folders exist
                    current_path = ""
                    for i in range(len(path_parts) - 1):
                        parent_folder_id = f"{zip_name}/{current_path}" if current_path else zip_name
                        current_path = f"{current_path}/{path_parts[i]}" if current_path else path_parts[i]
                        folder_key = f"{zip_name}/{current_path}"
                        
                        if folder_key not in added_folders:
                            archives.append({
                                "key": folder_key,
                                "name": path_parts[i],
                                "type": "folder",
                                "folderId": parent_folder_id,
                                "timestamp": timestamp,
                                "collapsed": False
                            })
                            added_folders.add(folder_key)
                    
                    if not info.is_dir():
                        parent_folder_id = f"{zip_name}/{'/'.join(path_parts[:-1])}" if len(path_parts) > 1 else zip_name
                        archives.append({
                            "key": f"{zip_name}/{info.filename}",
                            "name": path_parts[-1],
                            "type": "image",
                            "folderId": parent_folder_id,
                            "timestamp": timestamp,
                            "blob": None  # Blob is not returned here, must be extracted
                        })
        except Exception:
            # Skip corrupted zips
            continue
            
    return archives

def extract_file(zip_name: str, path: str) -> Tuple[bytes, str]:
    if ".." in zip_name or "/" in zip_name or "\\" in zip_name:
        raise ArchiveValidationError("Invalid archive name")
    
    zip_path = ARCHIVES_DIR / zip_name
    if not zip_path.exists():
        raise ArchiveNotFoundError("Archive not found")
        
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            if path not in zf.namelist():
                raise ArchiveNotFoundError("File not found in archive")
            
            content = zf.read(path)
            
            # Determine mime type roughly
            mime_type = "application/octet-stream"
            lower_path = path.lower()
            if lower_path.endswith(".png"):
                mime_type = "image/png"
            elif lower_path.endswith(".jpg") or lower_path.endswith(".jpeg"):
                mime_type = "image/jpeg"
            elif lower_path.endswith(".json"):
                mime_type = "application/json"
                
            return content, mime_type
    except ArchiveNotFoundError:
        raise
    except Exception as e:
        raise ArchiveServiceError(str(e))

def delete_archive(zip_name: str) -> None:
    if ".." in zip_name or "/" in zip_name or "\\" in zip_name:
        raise ArchiveValidationError("Invalid archive name")
    
    zip_path = ARCHIVES_DIR / zip_name
    if not zip_path.exists():
        raise ArchiveNotFoundError("Archive not found")
        
    try:
        zip_path.unlink()
    except Exception as e:
        raise ArchiveServiceError(str(e))
