"""/api/usage — Gemini usage of this app (Cost Monitor, data/usage.db). Aggregated here, not in the browser.

Days and months are the viewer's local calendar: the frontend sends its time and UTC offset.
"""

from typing import Any, Literal

from fastapi import APIRouter, Query
from starlette.concurrency import run_in_threadpool

from ..services import pricing, usage_store
from ..services.usage_service import LOCAL_USER

router = APIRouter(prefix="/usage", tags=["usage"])

TzOffset = Query(0, ge=-840, le=840, description="The viewer's UTC offset in minutes, e.g. 540 for JST.")


@router.get("/summary")
async def usage_summary(
    now_ms: int = Query(description="The viewer's current time (UTC epoch ms)."),
    tz_offset_minutes: int = TzOffset,
    range: Literal["7d", "30d", "90d", "month", "all"] = Query("30d", description="Period ending today."),  # noqa: A002
) -> dict[str, Any]:
    """Totals of today and this month; for the period: totals, cost per day and tool, per tool and per model."""
    result = await run_in_threadpool(usage_store.summary, LOCAL_USER, now_ms, tz_offset_minutes, range)
    return {**result, "prices_checked_on": pricing.PRICES_CHECKED_ON}


@router.get("/day")
async def usage_day(
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$", description="Local day YYYY-MM-DD."),
    tz_offset_minutes: int = TzOffset,
) -> dict[str, Any]:
    """One day: ``{day, total, by_tool, by_model, records (newest first)}``."""
    return await run_in_threadpool(usage_store.day_detail, LOCAL_USER, date, tz_offset_minutes)


@router.get("/records")
async def usage_records(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    """One page of records, newest first: ``{records, total}``."""
    return await run_in_threadpool(usage_store.list_records, LOCAL_USER, offset, limit)
