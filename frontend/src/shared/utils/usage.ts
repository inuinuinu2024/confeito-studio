/**
 * Cost Monitor display helpers (docs/specs/cost-monitor.md). The backend aggregates (/api/usage/*);
 * this file decides the periods, the chart series, averages and the yen / USD formats.
 */
import type { UsageDay, UsageRange, UsageTotal } from '../api/usage';

export const DEFAULT_USD_JPY_RATE = 150;
export const DEFAULT_RANGE: UsageRange = '30d';

/** The period buttons, in order. */
export const RANGE_OPTIONS: { value: UsageRange; label: string }[] = [
  { value: '7d', label: '7日' },
  { value: '30d', label: '30日' },
  { value: '90d', label: '90日' },
  { value: 'month', label: '今月' },
  { value: 'all', label: '全期間' },
];

export function parseRange(value: string): UsageRange {
  return RANGE_OPTIONS.some(o => o.value === value) ? (value as UsageRange) : DEFAULT_RANGE;
}

/** "直近 30 日" / "今月" / "全期間": the period as the tiles name it. */
export function rangeName(range: UsageRange): string {
  return range === 'month' ? '今月' : range === 'all' ? '全期間' : `直近 ${range.slice(0, -1)} 日`;
}

/**
 * Average cost of one call (USD) over the calls with a known price; null when there is none.
 * Calls without a price are left out so that they do not pull the average down.
 */
export function perCallUsd(total: Pick<UsageTotal, 'cost_usd' | 'count' | 'unpriced'>): number | null {
  const priced = total.count - total.unpriced;
  return priced > 0 ? total.cost_usd / priced : null;
}

/** Share of `part` in `whole` as "42%" ("—" for an empty whole). */
export function formatShare(part: number, whole: number): string {
  if (whole <= 0) return '—';
  const pct = (part / whole) * 100;
  return pct > 0 && pct < 1 ? '1%未満' : `${Math.round(pct)}%`;
}

/** Local calendar day "YYYY-MM-DD" of a date. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** "10/4（日）" for a local day "YYYY-MM-DD"; with the year when it is not `currentYear`. */
export function dayTitle(day: string, currentYear: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${y === currentYear ? '' : `${y}/`}${m}/${d}（${weekday}）`;
}

/** Label every n-th day on the chart's time axis, so that about 8 labels fit whatever the period. */
export function labelEvery(days: number): number {
  return Math.max(1, Math.ceil(days / 8));
}

export const OTHER_SERIES = 'その他';

/** Tools in the order of their chart colors; any other tool is placed after these. */
export const TOOL_ORDER = ['Nano Banana画像生成', 'コマ分割'];
/** Colored series in the chart; tools past this fold into OTHER_SERIES. */
export const MAX_SERIES = 3;

/** Chart series in fixed order: the known tools first, then others by name; past MAX_SERIES → "その他". */
export function chartSeries(tools: readonly string[]): { series: string[]; seriesOf: (tool: string) => string } {
  const sorted = [...new Set(tools)].sort((a, b) => {
    const ia = TOOL_ORDER.indexOf(a);
    const ib = TOOL_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    return a.localeCompare(b, 'ja');
  });
  const named = sorted.length > MAX_SERIES ? sorted.slice(0, MAX_SERIES - 1) : sorted;
  const series = sorted.length > MAX_SERIES ? [...named, OTHER_SERIES] : named;
  return { series, seriesOf: tool => (named.includes(tool) ? tool : OTHER_SERIES) };
}

/** The days with their tools folded into the chart series. */
export function toSeriesDays(days: readonly UsageDay[], seriesOf: (tool: string) => string): UsageDay[] {
  return days.map(day => {
    const bySeries: Record<string, number> = {};
    for (const [tool, usd] of Object.entries(day.by_tool)) {
      const series = seriesOf(tool);
      bySeries[series] = (bySeries[series] ?? 0) + usd;
    }
    return { ...day, by_tool: bySeries };
  });
}

/** "$5.12" / "$0.134" / "$0.0012": 2 decimals from $1, more below so small amounts do not read as 0. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  const abs = Math.abs(usd);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** The yen number at `rate` yen per USD: "1,234", one decimal under 10 yen ("0.4"), "0". */
export function jpyNumber(usd: number, rate: number): string {
  const yen = usd * rate;
  if (yen === 0) return '0';
  return Math.abs(yen) < 10 ? yen.toFixed(1) : Math.round(yen).toLocaleString('ja-JP');
}

/** "約 20 円" at `rate` yen per USD ("0 円" for nothing). */
export function formatJpy(usd: number, rate: number): string {
  return usd === 0 ? '0 円' : `約 ${jpyNumber(usd, rate)} 円`;
}

/** A positive yen-per-USD rate from user input, or null. */
export function parseRate(text: string): number | null {
  const value = Number(text.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Token counts with thousands separators ("12,345"). */
export function formatCount(n: number): string {
  return n.toLocaleString('ja-JP');
}
