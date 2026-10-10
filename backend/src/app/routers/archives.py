"""/api/archives — folder-based archive storage (see services/archive_service.py)."""

from functools import partial
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from ..services import archive_service as svc
from ..services import archive_transfer, flow_service

router = APIRouter(prefix="/archives", tags=["archives"])


class PathsRequest(BaseModel):
    """Paths relative to the archive folder."""

    paths: list[str]


class ExportRequest(BaseModel):
    """Archive ids to write into one zip."""

    names: list[str]


class ImagesRequest(BaseModel):
    """Image keys ("<archive>/<path>") to write into one zip."""

    keys: list[str]


class MetaRequest(BaseModel):
    """The new display name of an archive."""

    name: str


class FlowSelectionRequest(BaseModel):
    """The run shown for one stack of the flow (``folder`` null: the newest run)."""

    stack: str
    folder: str | None = None


class FlowMergeRequest(BaseModel):
    """The image コマ結合 pastes for one panel (``image`` null: the newest image made from it)."""

    panel: str
    image: str | None = None


@router.post("")
async def save_archive(
    name: str = Form(...),
    files: list[UploadFile] = File(...),
    paths: list[str] = Form(...),
) -> dict:
    """Creates the archive if needed and writes ``files[i]`` to ``paths[i]``."""
    if len(files) != len(paths):
        raise svc.ArchiveValidationError("ファイルとパスの数が一致しません。")
    files_data = [(path, await file.read()) for file, path in zip(files, paths, strict=True)]
    return {"status": "success", "archive": svc.save_archive(name, files_data)}


@router.post("/results")
async def save_result(
    name: str = Form(...),
    files: list[UploadFile] = File(...),
    paths: list[str] = Form(...),
    root: str | None = Form(None),
    info: str | None = Form(None),
) -> dict:
    """Saves a tool result into ``<root>/<name>/`` (new archive ``<name>`` without ``root``) plus info.json.

    Returns the folder key actually used (``_2`` ... is appended instead of overwriting) and the
    display name of its archive.
    """
    if len(files) != len(paths):
        raise svc.ArchiveValidationError("ファイルとパスの数が一致しません。")
    files_data = [(path, await file.read()) for file, path in zip(files, paths, strict=True)]
    folder = svc.save_result(root, name, files_data, svc.parse_result_info(info))
    archive_name = svc.read_meta(svc.split_archive_path(folder)[0])["name"]
    return {"status": "success", "folder": folder, "archive_name": archive_name}


@router.get("")
async def list_archives() -> list[svc.ArchiveEntry]:
    return svc.list_archives()


@router.put("/{archive_name}/meta")
async def rename_archive(archive_name: str, req: MetaRequest) -> svc.ArchiveMeta:
    """Changes the display name (the folder name, i.e. the archive's id, stays)."""
    return svc.rename_archive(archive_name, req.name)


def _zip_download(path: Path, name: str) -> FileResponse:
    """The temp zip ``path`` as a download (file name in ``X-File-Name``), removed after sending."""
    return FileResponse(
        path,
        media_type="application/zip",
        filename=name,
        headers={"X-File-Name": quote(name)},
        background=BackgroundTask(path.unlink, missing_ok=True),
    )


@router.get("/details")
async def archive_details() -> list[flow_service.ArchiveSummary]:
    """Every archive with its display name, counts, size and cover image (Archive Manager), newest first."""
    return await run_in_threadpool(flow_service.archive_summaries)


@router.post("/export")
async def export_archives(req: ExportRequest) -> FileResponse:
    """The archives as one zip download."""
    write = partial(archive_transfer.export_archives, req.names)
    return _zip_download(*await run_in_threadpool(archive_transfer.to_temp, write))


@router.post("/export-images")
async def export_images(req: ImagesRequest) -> FileResponse:
    """The images side by side in one zip download (the work to use outside the app)."""
    write = partial(archive_transfer.export_images, req.keys)
    return _zip_download(*await run_in_threadpool(archive_transfer.to_temp, write))


@router.post("/import")
async def import_archives(file: UploadFile = File(...)) -> dict[str, Any]:
    """Adds every archive in the zip as a new archive (an id / display name in use gets "_2" / " (2)")."""
    result = await run_in_threadpool(archive_transfer.import_zip, file.file, file.filename or "archive.zip")
    return {"imported": result.imported, "skipped_files": result.skipped_files, "warnings": result.warnings}


@router.get("/{archive_name}/contents")
async def list_archive_contents(archive_name: str) -> list[svc.ArchiveEntry]:
    return svc.list_archive_contents(archive_name)


@router.get("/{archive_name}/extract")
async def extract_file(archive_name: str, path: str) -> Response:
    content, mime_type = svc.extract_file(archive_name, path)
    return Response(content=content, media_type=mime_type)


@router.get("/{archive_name}/flow")
async def get_flow(archive_name: str) -> flow_service.Flow:
    """Roots, tool runs and the shown run of each stack (Normal mode canvas)."""
    return await run_in_threadpool(flow_service.get_flow, archive_name)


@router.put("/{archive_name}/flow/selection")
async def set_flow_selection(archive_name: str, req: FlowSelectionRequest) -> dict:
    flow_service.set_selection(archive_name, req.stack, req.folder)
    return {"status": "success"}


@router.put("/{archive_name}/flow/merge")
async def set_flow_merge(archive_name: str, req: FlowMergeRequest) -> dict:
    flow_service.set_merge_choice(archive_name, req.panel, req.image)
    return {"status": "success"}


@router.get("/{archive_name}/thumbnail")
async def thumbnail(archive_name: str, path: str, size: int = 320) -> Response:
    """A small copy of an image for the flow cells (the frontend keeps it in memory, not the HTTP cache)."""
    content, mime_type = await run_in_threadpool(flow_service.thumbnail, archive_name, path, size)
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
