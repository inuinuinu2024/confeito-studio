"""Gemini API prices (pure data and arithmetic) for the Cost Monitor (docs/specs/cost-monitor.md).

Source: https://ai.google.dev/gemini-api/docs/pricing, checked on ``PRICES_CHECKED_ON``. Prices are USD per
1M tokens; thinking tokens are billed as text output. A model's rates can change on a date, so each model
has a list of ``(effective from, rates per service tier)``. Costs are computed when a call is recorded and
stored with the record, so a later price change does not rewrite past costs.

Simplifications (shown on the dashboard):
* Google Search grounding is counted at ``SEARCH_USD_PER_QUERY`` for every query: the monthly free allowance
  is shared by the whole project, which this app cannot see.
* Cached input tokens are billed at the normal input rate (an upper bound).
* Long prompt rates (over ``LONG_PROMPT_TOKENS``) are only listed for the standard tier; other tiers use their
  normal rates.
"""

from dataclasses import dataclass
from datetime import date
from typing import TypedDict

PRICES_CHECKED_ON = "2026-10-04"
LONG_PROMPT_TOKENS = 200_000
SEARCH_USD_PER_QUERY = 14.0 / 1000
STANDARD_TIER = "standard"


class Usage(TypedDict):
    """Token counts of one Gemini call (services/usage_service.py builds it from the response)."""

    input_tokens: int
    """Prompt tokens, including tool use (search results) and cached tokens."""
    cached_tokens: int
    output_text_tokens: int
    output_image_tokens: int
    thought_tokens: int
    search_queries: int
    images: int


@dataclass(frozen=True)
class Rates:
    """USD per 1M tokens."""

    input: float
    output_text: float
    output_image: float = 0.0
    input_long: float | None = None
    output_text_long: float | None = None


Schedule = list[tuple[date, dict[str, Rates]]]
"""(effective from, rates per service tier), oldest first."""

_ALWAYS = date(2000, 1, 1)

PRICES: dict[str, Schedule] = {
    "gemini-3-pro-image": [
        (
            _ALWAYS,
            {
                "standard": Rates(2.00, 12.00, 120.00),
                "priority": Rates(3.60, 21.60, 216.00),
            },
        )
    ],
    "gemini-3.1-flash-image": [
        (
            _ALWAYS,
            {
                "standard": Rates(0.50, 3.00, 60.00),
                "flex": Rates(0.25, 1.50, 30.00),
            },
        )
    ],
    "gemini-3.1-flash-lite-image": [
        (
            _ALWAYS,
            {
                "standard": Rates(0.25, 1.50, 30.00),
                "flex": Rates(0.125, 0.75, 15.00),
            },
        )
    ],
    "gemini-2.5-flash-image": [
        (
            _ALWAYS,
            {
                "standard": Rates(0.30, 0.0, 30.00),
                "flex": Rates(0.15, 0.0, 15.00),
                "priority": Rates(0.54, 0.0, 54.00),
            },
        )
    ],
    "gemini-3.8-flash": [
        (_ALWAYS, {"standard": Rates(0.75, 3.75), "flex": Rates(0.375, 1.875)}),
        (date(2027, 1, 1), {"standard": Rates(1.50, 7.50), "flex": Rates(0.75, 3.75)}),
    ],
    "gemini-3.1-pro-preview": [
        (
            _ALWAYS,
            {
                "standard": Rates(2.00, 12.00, input_long=4.00, output_text_long=18.00),
                "flex": Rates(1.00, 6.00),
                "priority": Rates(3.60, 21.60),
            },
        )
    ],
}

IMAGE_TOKENS: dict[str, dict[str, int]] = {
    "gemini-3-pro-image": {"1K": 1120, "2K": 1120, "4K": 2000},
    "gemini-3.1-flash-image": {"512": 747, "1K": 1120, "2K": 1680, "4K": 2520},
    "gemini-3.1-flash-lite-image": {"1K": 1120},
    "gemini-2.5-flash-image": {"1K": 1290},
}
"""Output tokens of one image per size, for responses without usage data (the default size is 1K)."""


def rates_for(model: str, service_tier: str | None, at: date) -> Rates | None:
    """The rates in effect on ``at``; None for a model or tier without a listed price."""
    schedule = PRICES.get(model)
    if not schedule:
        return None
    current = None
    for since, tiers in schedule:
        if since <= at:
            current = tiers
    if current is None:
        return None
    return current.get(service_tier or STANDARD_TIER)


def image_tokens(model: str, image_size: str | None) -> int | None:
    """Output tokens of one image of ``image_size`` (default 1K), or None when unknown."""
    sizes = IMAGE_TOKENS.get(model)
    if not sizes:
        return None
    return sizes.get(image_size or "1K")


def cost_usd(model: str, service_tier: str | None, usage: Usage, at: date) -> float | None:
    """USD cost of one call, or None when the model / tier has no listed price."""
    rates = rates_for(model, service_tier, at)
    if rates is None:
        return None
    long_prompt = usage["input_tokens"] > LONG_PROMPT_TOKENS
    input_rate = rates.input_long if long_prompt and rates.input_long is not None else rates.input
    text_rate = rates.output_text_long if long_prompt and rates.output_text_long is not None else rates.output_text
    per_million = (
        usage["input_tokens"] * input_rate
        + (usage["output_text_tokens"] + usage["thought_tokens"]) * text_rate
        + usage["output_image_tokens"] * rates.output_image
    )
    return per_million / 1_000_000 + usage["search_queries"] * SEARCH_USD_PER_QUERY
