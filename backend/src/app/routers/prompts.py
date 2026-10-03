"""/api/prompts — the prompts the user registers, shared by every tool (assets/prompts/prompts.json)."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..services import prompt_service as svc

router = APIRouter(prefix="/prompts", tags=["prompts"])


class PromptBody(BaseModel):
    name: str
    category: str = ""
    text: str


class CategoryBody(BaseModel):
    category: str


class PromptOrderBody(BaseModel):
    category: str
    ids: list[str]


class CategoryOrderBody(BaseModel):
    categories: list[str]


class RenameCategoryBody(BaseModel):
    old: str
    new: str


class ImportBody(BaseModel):
    prompts: list[Any]
    categories: list[Any] = []
    on_conflict: svc.OnConflict = "skip"


def _prompt(result: svc.PromptResult) -> dict[str, Any]:
    return {"prompt": result.prompt, "warnings": result.warnings}


@router.get("")
async def list_prompts() -> dict[str, Any]:
    """The categories and the prompts in display order, and warnings to show (a broken file)."""
    store = svc.list_prompts()
    return {"categories": store.categories, "prompts": store.prompts, "warnings": store.warnings}


@router.post("")
async def create_prompt(body: PromptBody) -> dict[str, Any]:
    return _prompt(svc.create_prompt(body.name, body.category, body.text))


# Fixed paths come before "/{prompt_id}" so that "order" / "categories" are not taken for an id.
@router.put("/order")
async def reorder_prompts(body: PromptOrderBody) -> dict[str, Any]:
    return {"warnings": svc.reorder_prompts(body.category, body.ids)}


@router.put("/categories/order")
async def reorder_categories(body: CategoryOrderBody) -> dict[str, Any]:
    return {"warnings": svc.reorder_categories(body.categories)}


@router.post("/categories/rename")
async def rename_category(body: RenameCategoryBody) -> dict[str, Any]:
    return {"warnings": svc.rename_category(body.old, body.new)}


@router.post("/import")
async def import_prompts(body: ImportBody) -> dict[str, Any]:
    result = svc.import_prompts(body.prompts, body.categories, body.on_conflict)
    return {
        "added": result.added,
        "overwritten": result.overwritten,
        "skipped": result.skipped,
        "invalid": result.invalid,
        "warnings": result.warnings,
    }


@router.put("/{prompt_id}")
async def update_prompt(prompt_id: str, body: PromptBody) -> dict[str, Any]:
    return _prompt(svc.update_prompt(prompt_id, body.name, body.category, body.text))


@router.delete("/{prompt_id}")
async def delete_prompt(prompt_id: str) -> dict[str, Any]:
    return {"warnings": svc.delete_prompt(prompt_id)}


@router.post("/{prompt_id}/duplicate")
async def duplicate_prompt(prompt_id: str) -> dict[str, Any]:
    return _prompt(svc.duplicate_prompt(prompt_id))


@router.put("/{prompt_id}/category")
async def move_prompt(prompt_id: str, body: CategoryBody) -> dict[str, Any]:
    return _prompt(svc.move_prompt(prompt_id, body.category))
