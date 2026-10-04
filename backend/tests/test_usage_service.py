"""Cost Monitor: prices, usage extraction, the usage records and recording from the Gemini tools.

Gemini is never called: ``requests.post`` / ``gemini.generate_content`` are stubbed.
"""

import base64
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from src.app.providers import gemini
from src.app.services import panel_service, pricing, usage_service, usage_store
from src.app.services.pricing import Usage

from .conftest import make_png


def usage(**counts: int) -> Usage:
    base: Usage = {
        "input_tokens": 0,
        "cached_tokens": 0,
        "output_text_tokens": 0,
        "output_image_tokens": 0,
        "thought_tokens": 0,
        "search_queries": 0,
        "images": 0,
    }
    return {**base, **counts}  # type: ignore[typeddict-item]


# ── pricing ────────────────────────────────────────────────


def test_cost_of_a_pro_image() -> None:
    # 1K image = 1120 image tokens at $120/1M = $0.1344, plus 500 input at $2 and 200 thoughts at $12.
    cost = pricing.cost_usd(
        "gemini-3-pro-image",
        None,
        usage(input_tokens=500, output_image_tokens=1120, thought_tokens=200),
        date(2026, 10, 4),
    )
    assert cost == pytest.approx(0.001 + 0.1344 + 0.0024)


def test_cost_uses_the_rates_in_effect_on_the_day() -> None:
    u = usage(input_tokens=1_000_000)
    assert pricing.cost_usd("gemini-3.8-flash", None, u, date(2026, 12, 31)) == pytest.approx(0.75)
    assert pricing.cost_usd("gemini-3.8-flash", None, u, date(2027, 1, 1)) == pytest.approx(1.50)


def test_cost_of_long_prompts_and_tiers() -> None:
    long_prompt = usage(input_tokens=300_000, output_text_tokens=1_000_000)
    assert pricing.cost_usd("gemini-3.1-pro-preview", "standard", long_prompt, date(2026, 10, 4)) == pytest.approx(
        0.3 * 4.00 + 18.00
    )
    # Flex has no long prompt rate: its normal rate is used.
    assert pricing.cost_usd("gemini-3.1-pro-preview", "flex", long_prompt, date(2026, 10, 4)) == pytest.approx(
        0.3 * 1.00 + 6.00
    )


def test_search_queries_are_counted_without_the_free_allowance() -> None:
    cost = pricing.cost_usd("gemini-3-pro-image", None, usage(search_queries=2), date(2026, 10, 4))
    assert cost == pytest.approx(0.028)


def test_unknown_model_or_tier_has_no_cost() -> None:
    assert pricing.cost_usd("gemini-9-unknown", None, usage(input_tokens=1), date(2026, 10, 4)) is None
    assert pricing.cost_usd("gemini-3-pro-image", "flex", usage(input_tokens=1), date(2026, 10, 4)) is None


# ── usage extraction ───────────────────────────────────────


def test_usage_from_generate_content() -> None:
    response = {
        "candidates": [{"groundingMetadata": {"webSearchQueries": ["a", "b"], "imageSearchQueries": ["c"]}}],
        "usageMetadata": {
            "promptTokenCount": 300,
            "toolUsePromptTokenCount": 50,
            "cachedContentTokenCount": 10,
            "candidatesTokenCount": 1140,
            "candidatesTokensDetails": [
                {"modality": "IMAGE", "tokenCount": 1120},
                {"modality": "TEXT", "tokenCount": 20},
            ],
            "thoughtsTokenCount": 400,
        },
    }
    assert usage_service.extract_usage("generate_content", response, images=1) == usage(
        input_tokens=350,
        cached_tokens=10,
        output_text_tokens=20,
        output_image_tokens=1120,
        thought_tokens=400,
        search_queries=3,
        images=1,
    )


def test_usage_from_interactions() -> None:
    response = {
        "usage": {
            "total_input_tokens": 300,
            "total_tool_use_tokens": 50,
            "total_cached_tokens": 0,
            "total_output_tokens": 2010,
            "output_tokens_by_modality": [{"modality": "image", "tokens": 2000}, {"modality": "text", "tokens": 10}],
            "total_thought_tokens": 100,
            "grounding_tool_count": [{"type": "google_search", "count": 2}],
        }
    }
    assert usage_service.extract_usage("interactions", response, images=1) == usage(
        input_tokens=350,
        output_text_tokens=10,
        output_image_tokens=2000,
        thought_tokens=100,
        search_queries=2,
        images=1,
    )


def test_no_usage_in_response() -> None:
    assert usage_service.extract_usage("generate_content", {"candidates": []}) is None
    assert usage_service.extract_usage("interactions", None) is None


# ── records (services/usage_store.py) ─────────────────────

JST = timezone(timedelta(hours=9))


def at_jst(month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, month, day, hour, minute, tzinfo=JST)


def add(at: datetime, tool: str, model: str, cost_model: str | None = None, **counts: int) -> dict[str, Any]:
    """Records a call; ``cost_model`` defaults to ``model`` (an unknown one gives no cost)."""
    entry = usage_service.record(
        tool=tool,
        model=cost_model or model,
        api="generate_content",
        service_tier=None,
        status="success",
        usage=usage(**counts),
        at=at,
    )
    assert entry is not None
    return entry


def test_record_and_list(data_dir: Path) -> None:
    entry = usage_service.record(
        tool="コマ分割",
        model="gemini-3.8-flash",
        api="generate_content",
        service_tier=None,
        status="success",
        usage=usage(input_tokens=1000, output_text_tokens=100),
        at=datetime(2026, 10, 4, 14, 32),
    )
    assert entry is not None
    assert entry["user"] == "local" and entry["service_tier"] == "standard"
    assert entry["cost_usd"] == pytest.approx((1000 * 0.75 + 100 * 3.75) / 1_000_000)
    assert entry["at"].startswith("2026-10-04T14:32:00")
    assert (data_dir / "data" / "usage.db").exists()

    assert usage_store.list_records("local", 0, 50) == {"records": [entry], "total": 1}


def test_records_are_paged_newest_first() -> None:
    entries = [add(at_jst(10, 4, hour), "コマ分割", "gemini-3.8-flash", input_tokens=hour) for hour in range(5)]

    page = usage_store.list_records("local", 1, 2)

    assert page["total"] == 5
    assert [r["id"] for r in page["records"]] == [entries[3]["id"], entries[2]["id"]]


def seed_days() -> dict[str, Any]:
    """1M input tokens of gemini-3.8-flash = $0.75. Returns the latest record."""
    add(at_jst(10, 4, 0, 5), "A", "gemini-3.8-flash", input_tokens=1_000_000)  # today in JST, yesterday in UTC
    add(at_jst(10, 3, 23, 55), "A", "gemini-3.8-flash", input_tokens=2_000_000)
    add(at_jst(9, 30, 12), "A", "gemini-3.8-flash", input_tokens=4_000_000)  # last month
    latest = add(at_jst(10, 4, 9), "B", "gemini-9-unknown", input_tokens=10)  # no price
    usage_store.insert({**latest, "id": "someone-else", "user": "other"})  # another user is not counted
    return latest


NOW_MS = int(at_jst(10, 4, 10).timestamp() * 1000)


def test_summary_of_a_range_by_local_day(data_dir: Path) -> None:
    latest = seed_days()

    result = usage_store.summary("local", NOW_MS, 540, "7d")

    periods = result["periods"]
    assert (periods["today"]["count"], periods["today"]["unpriced"]) == (2, 1)
    assert periods["today"]["cost_usd"] == pytest.approx(0.75)
    assert periods["month"]["cost_usd"] == pytest.approx(2.25)
    assert (periods["range"]["count"], periods["range"]["cost_usd"]) == (4, pytest.approx(5.25))
    assert periods["range"]["input_tokens"] == 7_000_010
    assert result["range"] == {"key": "7d", "start": "2026-09-28", "end": "2026-10-04", "days": 7}
    assert result["latest"]["id"] == latest["id"]
    assert [d["day"] for d in result["daily"]] == [f"2026-09-{d}" for d in (28, 29, 30)] + [
        f"2026-10-0{d}" for d in (1, 2, 3, 4)
    ]
    assert result["daily"][2] == {
        "day": "2026-09-30",
        "by_tool": {"A": pytest.approx(3.0)},
        "cost_usd": 3.0,
        "count": 1,
    }
    assert result["daily"][-1] == {
        "day": "2026-10-04",
        "by_tool": {"A": pytest.approx(0.75)},  # B has no price: not in the chart
        "cost_usd": pytest.approx(0.75),
        "count": 2,
    }
    assert [(r["name"], r["count"], r["unpriced"]) for r in result["by_model"]] == [
        ("gemini-3.8-flash", 3, 0),
        ("gemini-9-unknown", 1, 1),
    ]

    # In UTC the call at 00:05 JST belongs to the day before.
    assert usage_store.summary("local", NOW_MS, 0, "7d")["periods"]["today"]["count"] == 1


@pytest.mark.parametrize(
    ("range_key", "start", "days", "cost"),
    [("month", "2026-10-01", 4, 2.25), ("all", "2026-09-30", 5, 5.25), ("30d", "2026-09-05", 30, 5.25)],
)
def test_summary_ranges(range_key: str, start: str, days: int, cost: float) -> None:
    seed_days()

    result = usage_store.summary("local", NOW_MS, 540, range_key)

    assert (result["range"]["start"], result["range"]["days"], len(result["daily"])) == (start, days, days)
    assert result["periods"]["range"]["cost_usd"] == pytest.approx(cost)


def test_summary_of_all_without_records_is_today() -> None:
    result = usage_store.summary("local", NOW_MS, 540, "all")
    assert result["range"] == {"key": "all", "start": "2026-10-04", "end": "2026-10-04", "days": 1}
    assert result["latest"] is None and result["by_tool"] == []


def test_day_detail() -> None:
    latest = seed_days()

    day = usage_store.day_detail("local", "2026-10-04", 540)

    assert day["day"] == "2026-10-04"
    assert (day["total"]["count"], day["total"]["cost_usd"]) == (2, pytest.approx(0.75))
    assert [(r["name"], r["count"]) for r in day["by_tool"]] == [("A", 1), ("B", 1)]
    assert [r["name"] for r in day["by_model"]] == ["gemini-3.8-flash", "gemini-9-unknown"]
    assert day["records"][0]["id"] == latest["id"] and len(day["records"]) == 2
    # In UTC, 00:05 and 23:55 JST of different days are both on 2026-10-03.
    assert usage_store.day_detail("local", "2026-10-03", 0)["total"]["count"] == 2


def test_usage_routes(client) -> None:
    summary = client.get("/api/usage/summary", params={"now_ms": 1_790_000_000_000, "tz_offset_minutes": 540})
    body = summary.json()
    assert body["periods"]["range"]["count"] == 0 and body["latest"] is None
    assert body["range"]["key"] == "30d" and len(body["daily"]) == 30
    assert body["prices_checked_on"] == pricing.PRICES_CHECKED_ON
    bad_range = client.get("/api/usage/summary", params={"now_ms": 1, "range": "1y"})
    assert bad_range.status_code == 422
    day = client.get("/api/usage/day", params={"date": "2026-10-04", "tz_offset_minutes": 540}).json()
    assert day["total"]["count"] == 0 and day["records"] == []
    assert client.get("/api/usage/day", params={"date": "2026-13-01"}).status_code == 400
    assert client.get("/api/usage/day", params={"date": "10/04"}).status_code == 422
    assert client.get("/api/usage/records").json() == {"records": [], "total": 0}
    assert client.get("/api/usage/records", params={"limit": 500}).status_code == 422


# ── recording from the tools ──────────────────────────────


class FakeResponse:
    def __init__(self, status_code: int, body: Any, content_type: str = "application/json") -> None:
        self.status_code = status_code
        self.headers = {"Content-Type": content_type}
        self.content = body if isinstance(body, bytes) else b""
        self.text = "" if isinstance(body, bytes) else json.dumps(body)
        self._body = body

    def json(self) -> Any:
        return self._body


def records() -> list[dict[str, Any]]:
    return usage_store.list_records("local", 0, 200)["records"]


def test_generated_image_is_recorded(client, monkeypatch: pytest.MonkeyPatch) -> None:
    image = base64.b64encode(make_png(2, 2)).decode()
    response = {
        "candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": image}}]}}],
        "usageMetadata": {
            "promptTokenCount": 100,
            "candidatesTokenCount": 1120,
            "candidatesTokensDetails": [{"modality": "IMAGE", "tokenCount": 1120}],
        },
    }
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.requests, "post", lambda *a, **kw: FakeResponse(200, response))

    res = client.post(
        "/api/nano-banana-pro/generate-content",
        json={"model": "gemini-3-pro-image", "contents": [{"parts": [{"text": "hi"}]}], "serviceTier": "priority"},
    )

    assert res.status_code == 200
    [entry] = records()
    assert entry["tool"] == "Nano Banana画像生成" and entry["status"] == "success" and not entry["estimated"]
    assert entry["service_tier"] == "priority"
    assert entry["usage"]["output_image_tokens"] == 1120 and entry["usage"]["images"] == 1
    assert entry["cost_usd"] == pytest.approx((100 * 3.60 + 1120 * 216.00) / 1_000_000)


def test_blocked_generation_is_recorded_as_no_output(client, monkeypatch: pytest.MonkeyPatch) -> None:
    response = {"promptFeedback": {"blockReason": "SAFETY"}, "usageMetadata": {"promptTokenCount": 100}}
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.requests, "post", lambda *a, **kw: FakeResponse(200, response))

    res = client.post(
        "/api/nano-banana-pro/generate-content",
        json={"model": "gemini-3-pro-image", "contents": [{"parts": [{"text": "hi"}]}]},
    )

    assert res.status_code == 422
    [entry] = records()
    assert entry["status"] == "no_output" and entry["usage"]["images"] == 0
    assert entry["cost_usd"] == pytest.approx(100 * 2.00 / 1_000_000)


def test_image_without_usage_data_is_estimated(client, monkeypatch: pytest.MonkeyPatch) -> None:
    """The Interactions API can answer with the image bytes only: one image of the requested size is assumed."""
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.requests, "post", lambda *a, **kw: FakeResponse(200, make_png(2, 2), "image/png"))

    res = client.post(
        "/api/nano-banana-pro",
        json={
            "model": "gemini-3-pro-image",
            "input": [{"type": "text", "text": "hi"}],
            "response_format": {"type": "image", "image_size": "4K"},
        },
    )

    assert res.status_code == 200
    [entry] = records()
    assert entry["estimated"] and entry["api"] == "interactions"
    assert entry["cost_usd"] == pytest.approx(0.24)


def test_api_errors_are_not_recorded(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini.requests, "post", lambda *a, **kw: FakeResponse(429, {"error": {"message": "x"}}))

    client.post(
        "/api/nano-banana-pro/generate-content",
        json={"model": "gemini-3-pro-image", "contents": [{"parts": [{"text": "hi"}]}]},
    )

    assert records() == []


def test_panel_split_is_recorded(monkeypatch: pytest.MonkeyPatch) -> None:
    boxes = [{"panel_number": 1, "box_2d": [0, 0, 1000, 1000]}]
    response = {
        "candidates": [{"content": {"parts": [{"text": json.dumps(boxes)}]}}],
        "usageMetadata": {"promptTokenCount": 1000, "candidatesTokenCount": 50, "thoughtsTokenCount": 30},
    }
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setattr(gemini, "generate_content", lambda *a, **kw: FakeResponse(200, response))

    panel_service.split_panels(make_png(20, 20), model_name="gemini-3.8-flash")

    [entry] = records()
    assert entry["tool"] == "コマ分割" and entry["model"] == "gemini-3.8-flash" and entry["api"] == "generate_content"
    assert entry["usage"] == usage(input_tokens=1000, output_text_tokens=50, thought_tokens=30)
