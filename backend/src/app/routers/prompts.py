"""/api/prompts — the prompts the user registers, per tool (settings/prompts.json)."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..services import prompt_service as svc

router = APIRouter(prefix="/prompts", tags=["prompts"])


class PromptBody(BaseModel):
    name: str
    text: str


@router.get("/{tool}")
async def list_prompts(tool: str) -> dict[str, Any]:
    """The tool's registered prompts in order, and warnings to show (a broken file)."""
    result = svc.list_prompts(tool)
    return {"prompts": result.prompts, "warnings": result.warnings}


@router.post("/{tool}")
async def create_prompt(tool: str, body: PromptBody) -> dict[str, Any]:
    result = svc.create_prompt(tool, body.name, body.text)
    return {"prompt": result.prompt, "warnings": result.warnings}


@router.put("/{tool}/{prompt_id}")
async def update_prompt(tool: str, prompt_id: str, body: PromptBody) -> dict[str, Any]:
    result = svc.update_prompt(tool, prompt_id, body.name, body.text)
    return {"prompt": result.prompt, "warnings": result.warnings}


@router.delete("/{tool}/{prompt_id}")
async def delete_prompt(tool: str, prompt_id: str) -> dict[str, Any]:
    return {"warnings": svc.delete_prompt(tool, prompt_id)}
