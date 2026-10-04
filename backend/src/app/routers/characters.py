"""/api/characters — the characters the user registers, shared by every tool (assets/characters/)."""

from typing import Any

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from ..services import character_service as svc
from ..services import face_service

router = APIRouter(prefix="/characters", tags=["characters"])


class CategoryBody(BaseModel):
    category: str


class CharacterOrderBody(BaseModel):
    category: str
    ids: list[str]


class CategoryOrderBody(BaseModel):
    categories: list[str]


class RenameCategoryBody(BaseModel):
    old: str
    new: str


def _character(result: svc.CharacterResult) -> dict[str, Any]:
    return {"character": result.character, "warnings": result.warnings}


async def _uploads(files: list[UploadFile]) -> list[svc.Upload]:
    return [svc.Upload(file.filename or "", await file.read()) for file in files]


async def _icon(icon: UploadFile | None) -> bytes | None:
    return await icon.read() if icon is not None else None


@router.get("")
async def list_characters() -> dict[str, Any]:
    """The categories and the characters in display order, and warnings to show (a broken file)."""
    store = await run_in_threadpool(svc.list_characters)
    return {"categories": store.categories, "characters": store.characters, "warnings": store.warnings}


@router.post("")
async def create_character(
    data: str = Form(...), files: list[UploadFile] = File([]), icon: UploadFile | None = File(None)
) -> dict[str, Any]:
    fields = svc.parse_fields(data)
    uploads = await _uploads(files)
    return _character(await run_in_threadpool(svc.create_character, fields, uploads, await _icon(icon)))


# Fixed paths come before "/{character_id}" so that they are not taken for an id.
@router.put("/order")
async def reorder_characters(body: CharacterOrderBody) -> dict[str, Any]:
    return {"warnings": svc.reorder_characters(body.category, body.ids)}


@router.put("/categories/order")
async def reorder_categories(body: CategoryOrderBody) -> dict[str, Any]:
    return {"warnings": svc.reorder_categories(body.categories)}


@router.post("/categories/rename")
async def rename_category(body: RenameCategoryBody) -> dict[str, Any]:
    return {"warnings": svc.rename_category(body.old, body.new)}


@router.post("/detect-faces")
async def detect_faces(image: UploadFile = File(...)) -> dict[str, Any]:
    """Anime faces in the image (for the icon's crop frame); the model is downloaded on first use."""
    return {"faces": await run_in_threadpool(face_service.detect_faces, await image.read()), "warnings": []}


@router.get("/export")
async def export_characters() -> Response:
    """Every character with its images as a zip download (warnings are not reported here)."""
    name, content = await run_in_threadpool(svc.export_zip)
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/import/preview")
async def preview_import(file: UploadFile = File(...)) -> dict[str, Any]:
    result = await run_in_threadpool(svc.preview_import, await file.read())
    return {
        "count": result.count,
        "conflicts": result.conflicts,
        "invalid": result.invalid,
        "warnings": result.warnings,
    }


@router.post("/import")
async def import_characters(file: UploadFile = File(...), on_conflict: svc.OnConflict = Form("skip")) -> dict[str, Any]:
    result = await run_in_threadpool(svc.import_zip, await file.read(), on_conflict)
    return {
        "added": result.added,
        "overwritten": result.overwritten,
        "skipped": result.skipped,
        "invalid": result.invalid,
        "skipped_images": result.skipped_images,
        "warnings": result.warnings,
    }


@router.put("/{character_id}")
async def update_character(
    character_id: str,
    data: str = Form(...),
    files: list[UploadFile] = File([]),
    icon: UploadFile | None = File(None),
) -> dict[str, Any]:
    fields = svc.parse_fields(data)
    uploads = await _uploads(files)
    return _character(await run_in_threadpool(svc.update_character, character_id, fields, uploads, await _icon(icon)))


@router.delete("/{character_id}")
async def delete_character(character_id: str) -> dict[str, Any]:
    return {"warnings": await run_in_threadpool(svc.delete_character, character_id)}


@router.post("/{character_id}/duplicate")
async def duplicate_character(character_id: str) -> dict[str, Any]:
    return _character(await run_in_threadpool(svc.duplicate_character, character_id))


@router.put("/{character_id}/category")
async def move_character(character_id: str, body: CategoryBody) -> dict[str, Any]:
    return _character(svc.move_character(character_id, body.category))


@router.get("/{character_id}/images/{name}")
async def character_image(character_id: str, name: str) -> FileResponse:
    path = svc.image_path(character_id, name)
    return FileResponse(path, media_type=svc.MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"))


@router.get("/{character_id}/icon")
async def character_icon(character_id: str) -> FileResponse:
    return FileResponse(svc.icon_path(character_id), media_type="image/png")
