"""/api/local-files — files on the PC running the backend (画像読み込み's file dialog)."""

import mimetypes
from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from ..services.file_dialog_service import normalize_folder, pick_image_file

router = APIRouter(prefix="/local-files", tags=["local-files"])


class FolderBody(BaseModel):
    path: str = ""


class PickImageBody(BaseModel):
    initial_dir: str = ""


@router.post("/check-folder")
async def api_check_folder(body: FolderBody) -> dict:
    """404 unless the folder exists (an empty path is fine: the dialog's default)."""
    normalize_folder(body.path)
    return {"ok": True}


@router.post("/pick-image")
async def api_pick_image(body: PickImageBody) -> Response:
    """Opens the dialog in ``initial_dir``; the chosen image (name in ``X-File-Name``), or 204 when cancelled."""
    picked = await run_in_threadpool(pick_image_file, body.initial_dir)
    if picked is None:
        return Response(status_code=204)
    name, data = picked
    return Response(
        content=data,
        media_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
        headers={"X-File-Name": quote(name)},
    )
