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
from ..services.merge_service import merge_panels, parse_boxes, parse_overrides
from ..services.panel_service import build_preview, parse_box, recrop_panel, split_panels

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
    image_bytes = await _read_upload(image, "画像データが提供されていません。")
    with unexpected_errors_as("背景除去の処理中にエラーが発生しました。"):
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
    source_key: str | None = Form(None),
    api_key: str | None = Header(None, alias="X-API-Key"),
) -> dict:
    """Detects panels with Gemini and saves them as 01.png, 02.png, ... + panels.json + info.json."""
    image_bytes = await _read_upload(image, "画像データが提供されていません。")
    with unexpected_errors_as("コマ分割の処理中にエラーが発生しました。"):
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
            source_key=source_key,
        )


@router.post("/split-panels/preview")
async def api_split_panels_preview(
    reading_order: str = Form("left_to_right"),
    model_name: str = Form(panel_geometry.DEFAULT_MODEL),
    thinking_level: str = Form("LOW"),
) -> dict:
    """The Gemini request that /split-panels would send (for the tool's JSON preview)."""
    return build_preview(reading_order, model_name, thinking_level)


@router.post("/recrop-panel")
async def api_recrop_panel(panel_key: str = Form(...), box: str = Form(...)) -> dict:
    """Cuts a panel of a コマ分割 again from the split page with ``box`` (JSON ``[xmin, ymin, xmax, ymax]``)."""
    pixel_box = parse_box(box)
    with unexpected_errors_as("コマの切り直しの処理中にエラーが発生しました。"):
        return await run_in_threadpool(recrop_panel, panel_key, pixel_box)


@router.post("/merge-panels")
async def api_merge_panels(
    target_folder: str = Form(...), overrides: str | None = Form(None), boxes: str | None = Form(None)
) -> dict:
    """Pastes the panels listed in ``<target_folder>/panels.json`` back into one image.

    ``overrides`` (JSON ``{panel file name: archive key}``) replaces panels with other images;
    ``boxes`` (JSON ``{panel file name: [xmin, ymin, xmax, ymax]}``) places panels cut again (コマ切り直し).
    """
    replacements = parse_overrides(overrides)
    placed = parse_boxes(boxes)
    with unexpected_errors_as("コマ結合の処理中にエラーが発生しました。"):
        return await run_in_threadpool(merge_panels, target_folder, replacements, placed)
