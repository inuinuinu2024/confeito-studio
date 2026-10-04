"""Gemini usage records of this app (Cost Monitor, docs/specs/cost-monitor.md).

Every Gemini call that is billed (HTTP 200, with or without a usable result) is recorded. Token counts come
from the response (generateContent ``usageMetadata``, Interactions ``usage``) and the cost is computed with
services/pricing.py when the call is recorded. Storage and aggregation are in services/usage_store.py.

A record never blocks the tool: a failed write is logged to the console and the tool's result is still
returned.
"""

import logging
import uuid
from datetime import datetime
from typing import Any, Literal

from . import pricing, usage_store
from .pricing import Usage

logger = logging.getLogger(__name__)

Api = Literal["interactions", "generate_content"]
Status = Literal["success", "no_output"]
"""success: the call returned what the tool asked for; no_output: answered without it (blocked etc.), still billed."""

LOCAL_USER = "local"
"""The user of every record until the web version has logins."""


def _int(value: Any) -> int:
    return value if isinstance(value, int) and value > 0 else 0


def _count_list(value: Any) -> int:
    return len(value) if isinstance(value, list) else 0


def _usage_from_generate_content(data: dict[str, Any], images: int) -> Usage | None:
    meta = data.get("usageMetadata")
    if not isinstance(meta, dict):
        return None
    details = meta.get("candidatesTokensDetails")
    image_tokens = sum(
        _int(d.get("tokenCount"))
        for d in (details if isinstance(details, list) else [])
        if isinstance(d, dict) and str(d.get("modality", "")).upper() == "IMAGE"
    )
    searches = 0
    for candidate in data.get("candidates") or []:
        grounding = candidate.get("groundingMetadata") if isinstance(candidate, dict) else None
        if isinstance(grounding, dict):
            searches += _count_list(grounding.get("webSearchQueries")) + _count_list(
                grounding.get("imageSearchQueries")
            )
    return {
        "input_tokens": _int(meta.get("promptTokenCount")) + _int(meta.get("toolUsePromptTokenCount")),
        "cached_tokens": _int(meta.get("cachedContentTokenCount")),
        "output_text_tokens": max(_int(meta.get("candidatesTokenCount")) - image_tokens, 0),
        "output_image_tokens": image_tokens,
        "thought_tokens": _int(meta.get("thoughtsTokenCount")),
        "search_queries": searches,
        "images": images,
    }


def _usage_from_interaction(data: dict[str, Any], images: int) -> Usage | None:
    usage = data.get("usage")
    if not isinstance(usage, dict):
        return None
    by_modality = usage.get("output_tokens_by_modality")
    image_tokens = sum(
        _int(m.get("tokens"))
        for m in (by_modality if isinstance(by_modality, list) else [])
        if isinstance(m, dict) and str(m.get("modality", "")).lower() == "image"
    )
    grounding = usage.get("grounding_tool_count")
    searches = sum(
        _int(g.get("count")) for g in (grounding if isinstance(grounding, list) else []) if isinstance(g, dict)
    )
    return {
        "input_tokens": _int(usage.get("total_input_tokens")) + _int(usage.get("total_tool_use_tokens")),
        "cached_tokens": _int(usage.get("total_cached_tokens")),
        "output_text_tokens": max(_int(usage.get("total_output_tokens")) - image_tokens, 0),
        "output_image_tokens": image_tokens,
        "thought_tokens": _int(usage.get("total_thought_tokens")),
        "search_queries": searches,
        "images": images,
    }


def extract_usage(api: Api, data: Any, images: int = 0) -> Usage | None:
    """Token counts in a Gemini response, or None when it has none. ``images``: images the tool got from it."""
    if not isinstance(data, dict):
        return None
    if api == "generate_content":
        return _usage_from_generate_content(data, images)
    return _usage_from_interaction(data, images)


def estimated_image_usage(model: str, image_size: str | None) -> Usage | None:
    """Usage of one generated image when the response carried no token counts (input unknown, counted as 0)."""
    tokens = pricing.image_tokens(model, image_size)
    if tokens is None:
        return None
    return {
        "input_tokens": 0,
        "cached_tokens": 0,
        "output_text_tokens": 0,
        "output_image_tokens": tokens,
        "thought_tokens": 0,
        "search_queries": 0,
        "images": 1,
    }


def record(
    *,
    tool: str,
    model: str,
    api: Api,
    service_tier: str | None,
    status: Status,
    usage: Usage,
    estimated: bool = False,
    at: datetime | None = None,
) -> dict[str, Any] | None:
    """Stores one record and returns it (None when it could not be written)."""
    now = (at or datetime.now()).astimezone()
    tier = service_tier or pricing.STANDARD_TIER
    entry = {
        "id": uuid.uuid4().hex,
        "at": now.isoformat(timespec="seconds"),
        "user": LOCAL_USER,
        "tool": tool,
        "model": model,
        "api": api,
        "service_tier": tier,
        "status": status,
        "usage": usage,
        "cost_usd": pricing.cost_usd(model, tier, usage, now.date()),
        "estimated": estimated,
        "prices_checked_on": pricing.PRICES_CHECKED_ON,
    }
    try:
        usage_store.insert(entry)
    except usage_store.UsageStoreError:
        logger.exception("Could not store the usage record")
        return None
    return entry


def record_response(
    *,
    tool: str,
    model: str,
    api: Api,
    service_tier: str | None,
    status: Status,
    response: Any,
    images: int = 0,
    estimate_image_size: str | None = None,
) -> dict[str, Any] | None:
    """Records a billed Gemini response. Without token counts in it, a successful image is estimated from
    ``estimate_image_size`` (pass it for image generation); otherwise nothing is recorded."""
    usage = extract_usage(api, response, images)
    estimated = False
    if usage is None and status == "success" and images > 0:
        usage = estimated_image_usage(model, estimate_image_size)
        estimated = True
    if usage is None:
        return None
    return record(
        tool=tool, model=model, api=api, service_tier=service_tier, status=status, usage=usage, estimated=estimated
    )
