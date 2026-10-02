"""/api/archives — folder-based archive storage (see services/archive_service.py)."""

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from ..services import archive_service as svc

router = APIRouter(prefix="/archives", tags=["archives"])


class PathsRequest(BaseModel):
    """Paths relative to the archive folder."""

    paths: list[str]


class AppendLogRequest(BaseModel):
    message: str
    file_name: str = "log.txt"


@router.post("")
async def save_archive(
    name: str = Form(...),
    files: list[UploadFile] = File(...),
    paths: list[str] = Form(...),
) -> dict:
    """Creates the archive if needed and writes ``files[i]`` to ``paths[i]``."""
    if len(files) != len(paths):
        raise svc.ArchiveValidationError("Mismatch between files and paths")
    files_data = [(path, await file.read()) for file, path in zip(files, paths, strict=True)]
    return {"status": "success", "archive": svc.save_archive(name, files_data)}


@router.get("")
async def list_archives() -> list[svc.ArchiveEntry]:
    return svc.list_archives()


@router.get("/{archive_name}/contents")
async def list_archive_contents(archive_name: str) -> list[svc.ArchiveEntry]:
    return svc.list_archive_contents(archive_name)


@router.get("/{archive_name}/extract")
async def extract_file(archive_name: str, path: str) -> Response:
    content, mime_type = svc.extract_file(archive_name, path)
    return Response(content=content, media_type=mime_type)


@router.delete("/{archive_name}")
async def delete_archive(archive_name: str) -> dict:
    """Moves the archive to .trash (restorable)."""
    svc.delete_archive(archive_name)
    return {"status": "success"}


@router.post("/{archive_name}/delete_contents")
async def delete_archive_contents(archive_name: str, req: PathsRequest) -> dict:
    """Moves files / sub-folders to .trash/.items (restorable with restore_contents)."""
    svc.delete_archive_contents(archive_name, req.paths)
    return {"status": "success"}


@router.post("/{archive_name}/restore_contents")
async def restore_archive_contents(archive_name: str, req: PathsRequest) -> dict:
    svc.restore_archive_contents(archive_name, req.paths)
    return {"status": "success"}


@router.post("/{archive_name}/restore")
async def restore_archive(archive_name: str) -> dict:
    svc.restore_archive(archive_name)
    return {"status": "success"}


@router.post("/{archive_name}/log")
async def append_archive_log(archive_name: str, req: AppendLogRequest) -> dict:
    svc.append_archive_log(archive_name, req.message, req.file_name)
    return {"status": "success"}
