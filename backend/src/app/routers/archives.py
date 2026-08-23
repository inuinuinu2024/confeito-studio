from typing import List
from fastapi import APIRouter, UploadFile, Form, File, HTTPException
from fastapi.responses import Response

from ..services.archive_service import (
    save_archive as svc_save_archive,
    list_archives as svc_list_archives,
    list_archive_contents as svc_list_archive_contents,
    extract_file as svc_extract_file,
    delete_archive as svc_delete_archive,
    restore_archive as svc_restore_archive,
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
    """Save generated tool result as a ZIP archive."""
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
    """List all zip archives mimicking the IDB CachedImage structure."""
    return svc_list_archives()

@router.get("/archives/{zip_name}/contents")
async def list_archive_contents(zip_name: str):
    """List contents of a specific zip archive."""
    try:
        return svc_list_archive_contents(zip_name)
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/archives/{zip_name}/extract")
async def extract_file(zip_name: str, path: str):
    """Extract a specific file from a ZIP archive."""
    try:
        content, mime_type = svc_extract_file(zip_name, path)
        return Response(content=content, media_type=mime_type)
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/archives/{zip_name}")
async def delete_archive(zip_name: str):
    """Delete a ZIP archive."""
    try:
        svc_delete_archive(zip_name)
        return {"status": "success"}
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/archives/{zip_name}/restore")
async def restore_archive(zip_name: str):
    """Restore a deleted ZIP archive from trash."""
    try:
        svc_restore_archive(zip_name)
        return {"status": "success"}
    except ArchiveValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ArchiveNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ArchiveServiceError as e:
        raise HTTPException(status_code=500, detail=str(e))
