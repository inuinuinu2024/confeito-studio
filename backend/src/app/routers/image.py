"""/api/image — local image processing and panel split/merge.

Blocking work (rembg, Gemini HTTP calls, Pillow) runs in the threadpool so that
health checks keep responding during long operations.
"""

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from ..errors import BadRequestError, unexpected_errors_as
from ..services import panel_geometry
from ..services.image_service import remove_background
from ..services.merge_service import merge_panels
from ..services.panel_service import build_preview, split_panels

router = APIRouter(prefix="/image", tags=["image"])


async def _read_upload(upload: UploadFile, empty_message: str) -> bytes:
    data = await upload.read()
    if not data:
        raise BadRequestError(empty_message)
    return data


@router.post("/remove-bg")
async def api_remove_background(
    image: UploadFile = File(...),
    alpha_matting: bool = Form(False),
    alpha_matting_foreground_threshold: int = Form(240),
    alpha_matting_background_threshold: int = Form(10),
    alpha_matting_erode_size: int = Form(10),
) -> Response:
    image_bytes = await _read_upload(image, "No image provided")
    result = await run_in_threadpool(
        remove_background,
        image_bytes,
        alpha_matting=alpha_matting,
        alpha_matting_foreground_threshold=alpha_matting_foreground_threshold,
        alpha_matting_background_threshold=alpha_matting_background_threshold,
        alpha_matting_erode_size=alpha_matting_erode_size,
    )
    return Response(content=result, media_type="image/png")


@router.post("/split-panels")
async def api_split_panels(
    image: UploadFile = File(...),
    reading_order: str = Form("left_to_right"),
    padding: int = Form(0),
    original_filename: str = Form("image.png"),
    model_name: str = Form(panel_geometry.DEFAULT_MODEL),
    thinking_level: str = Form("LOW"),
    target_folder: str | None = Form(None),
    api_key: str | None = Header(None, alias="X-API-Key"),
) -> dict:
    """Detects panels with Gemini and saves them as 01.png, 02.png, ... + panels.json."""
    image_bytes = await _read_upload(image, "画像データが提供されていません")
    with unexpected_errors_as("コマ分割処理中にエラーが発生しました"):
        return await run_in_threadpool(
            split_panels,
            image_bytes=image_bytes,
            original_filename=original_filename,
            reading_order=reading_order,
            padding=padding,
            api_key=api_key,
            model_name=model_name,
            thinking_level=thinking_level,
            target_folder=target_folder,
        )


@router.post("/split-panels/preview")
async def api_split_panels_preview(
    reading_order: str = Form("left_to_right"),
    model_name: str = Form(panel_geometry.DEFAULT_MODEL),
    thinking_level: str = Form("LOW"),
) -> dict:
    """The Gemini request that /split-panels would send (for the tool's JSON preview)."""
    return build_preview(reading_order, model_name, thinking_level)


@router.post("/merge-panels")
async def api_merge_panels(target_folder: str = Form(...)) -> dict:
    """Pastes the panels listed in ``<target_folder>/panels.json`` back into one image."""
    with unexpected_errors_as("コマ結合処理中にエラーが発生しました"):
        return await run_in_threadpool(merge_panels, target_folder)
