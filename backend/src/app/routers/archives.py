from typing import List
from fastapi import APIRouter, UploadFile, Form, File, HTTPException
from pydantic import BaseModel
from fastapi.responses import Response

from ..services.archive_service import (
    save_archive as svc_save_archive,
    list_archives as svc_list_archives,
    list_archive_contents as svc_list_archive_contents,
    extract_file as svc_extract_file,
    delete_archive as svc_delete_archive,
    restore_archive as svc_restore_archive,
    delete_archive_contents as svc_delete_archive_contents,
    append_archive_log as svc_append_archive_log,
    ArchiveNotFoundError,
    ArchiveValidationError,
    ArchiveServiceError
)

router = APIRouter()

@router.post("/archives")
async def save_archive(
    name: str = Form(...),
    files: List[UploadFile] = File(...),
    paths: List[str] = Form(...)
):
    """Save or append files to a folder-based archive."""
    if len(files) != len(paths):
        raise HTTPException(status_code=400, detail="Mismatch between files and paths")
    
    files_data = []
    for file, path in zip(files, paths):
        content = await file.read()
        files_data.append((path, content))
        
    try:
        archive_name = svc_save_archive(name, files_data)
        return {"status": "success", "archive": archive_name}
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/archives")
async def list_archives():
    """List all folder-based archives mimicking the IDB CachedImage structure."""
    return svc_list_archives()

@router.get("/archives/{archive_name}/contents")
async def list_archive_contents(archive_name: str):
    """List contents of a specific folder archive."""
    try:
        return svc_list_archive_contents(archive_name)
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/archives/{archive_name}/extract")
async def extract_file(archive_name: str, path: str):
    """Extract a specific file from a folder archive."""
    try:
        content, mime_type = svc_extract_file(archive_name, path)
        return Response(content=content, media_type=mime_type)
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/archives/{archive_name}")
async def delete_archive(archive_name: str):
    """Delete a folder archive (moves to .trash)."""
    try:
        svc_delete_archive(archive_name)
        return {"status": "success"}
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

class DeleteContentsRequest(BaseModel):
    paths: List[str]

@router.post("/archives/{archive_name}/delete_contents")
async def delete_archive_contents_api(archive_name: str, req: DeleteContentsRequest):
    """Delete specific files or subdirectories from a folder archive."""
    try:
        svc_delete_archive_contents(archive_name, req.paths)
        return {"status": "success"}
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/archives/{archive_name}/restore")
async def restore_archive(archive_name: str):
    """Restore a deleted folder archive from trash."""
    try:
        svc_restore_archive(archive_name)
        return {"status": "success"}
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))


class AppendLogRequest(BaseModel):
    message: str
    file_name: str = "log.txt"

@router.post("/archives/{archive_name}/log")
async def append_archive_log_api(archive_name: str, req: AppendLogRequest):
    """Append a log message to a log file inside a folder archive."""
    try:
        svc_append_archive_log(archive_name, req.message, req.file_name)
        return {"status": "success"}
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

