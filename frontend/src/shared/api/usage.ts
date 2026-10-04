/** /api/usage — Gemini usage of this app (Cost Monitor, data/usage.db), aggregated by the backend. */
import { requestJson } from './http';

/** Token counts of one Gemini call (backend services/pricing.py `Usage`). */
export interface UsageCounts {
  /** Prompt tokens, including tool use (search results) and cached tokens. */
  input_tokens: number;
  cached_tokens: number;
  output_text_tokens: number;
  output_image_tokens: number;
  thought_tokens: number;
  search_queries: number;
  /** Images the tool got from the call. */
  images: number;
}

export interface UsageRecord {
  id: string;
  /** ISO 8601 with the backend's UTC offset. */
  at: string;
  /** "local" until the web version has logins. */
  user: string;
  tool: string;
  model: string;
  api: 'interactions' | 'generate_content';
  service_tier: string;
  /** success: the tool got its result; no_output: answered without it (blocked etc.), still billed. */
  status: 'success' | 'no_output';
  usage: UsageCounts;
  /** Cost in USD at the prices of the day it was recorded; null when the model / tier has no listed price. */
  cost_usd: number | null;
  /** No token counts in the response: one image of the requested size was assumed. */
  estimated: boolean;
  prices_checked_on: string;
}

/** Sums over a set of records. */
export interface UsageTotal extends UsageCounts {
  count: number;
  /** Sum of the known costs (USD). */
  cost_usd: number;
  /** Calls whose model / tier has no listed price (not in cost_usd). */
  unpriced: number;
  /** Calls whose cost was estimated. */
  estimated: number;
}

export interface UsageBreakdownRow extends UsageTotal {
  /** Tool name or model id. */
  name: string;
}

export interface UsageDay {
  /** Local day "YYYY-MM-DD". */
  day: string;
  /** USD per tool (tools without a known cost are left out). */
  by_tool: Record<string, number>;
  cost_usd: number;
  count: number;
}

/** Period of the chart and the totals, ending today: the last 7 / 30 / 90 days, this month, or since the first record. */
export type UsageRange = '7d' | '30d' | '90d' | 'month' | 'all';

export interface UsageSummary {
  /** Today and this month, and the selected period. */
  periods: { today: UsageTotal; month: UsageTotal; range: UsageTotal };
  /** Local days "YYYY-MM-DD" of the period (start and end = today included). */
  range: { key: UsageRange; start: string; end: string; days: number };
  latest: UsageRecord | null;
  /** Every day of the period, oldest first. */
  daily: UsageDay[];
  /** In the period, most expensive first. */
  by_tool: UsageBreakdownRow[];
  by_model: UsageBreakdownRow[];
  /** The date the backend's price table was checked against the official prices. */
  prices_checked_on: string;
}

export interface UsageDayDetail {
  /** Local day "YYYY-MM-DD". */
  day: string;
  total: UsageTotal;
  by_tool: UsageBreakdownRow[];
  by_model: UsageBreakdownRow[];
  /** Newest first. */
  records: UsageRecord[];
}

/** The viewer's time and UTC offset: days and months follow the viewer's local calendar. */
function clock(now: Date): Record<string, string> {
  return { now_ms: String(now.getTime()), tz_offset_minutes: String(-now.getTimezoneOffset()) };
}

/** Totals for the viewer's local today / month and the period `range`. */
export async function getUsageSummary(now: Date, range: UsageRange): Promise<UsageSummary> {
  return requestJson(`/usage/summary?${new URLSearchParams({ ...clock(now), range })}`);
}

/** One local day "YYYY-MM-DD": totals, per tool and model, and its records. */
export async function getUsageDay(day: string, now: Date): Promise<UsageDayDetail> {
  const { tz_offset_minutes } = clock(now);
  return requestJson(`/usage/day?${new URLSearchParams({ date: day, tz_offset_minutes })}`);
}

/** One page of records, newest first. */
export async function listUsageRecords(
  offset: number,
  limit: number,
): Promise<{ records: UsageRecord[]; total: number }> {
  return requestJson(`/usage/records?${new URLSearchParams({ offset: String(offset), limit: String(limit) })}`);
}
