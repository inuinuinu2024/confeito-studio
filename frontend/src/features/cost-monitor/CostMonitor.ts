/**
 * Cost Monitor (docs/specs/cost-monitor.md) — the "cost" view mode: a dashboard of what the Gemini API
 * costs, in place of ARCHIVES and the canvas. Amounts are shown in yen first (at the rate the user enters)
 * with USD (the price list's currency = credits) beside them.
 *
 * - このアプリで使った分: every billed Gemini call made from this app, aggregated by the backend
 *   (/api/usage/summary for the selected period, /api/usage/day for the day picked on the chart,
 *   /api/usage/records for the paged history).
 * - Google 側の記録: not connected. No API reads the balance or the whole key's spend with an API key,
 *   so it links to Google AI Studio.
 *
 * Reloaded when the mode opens, with the refresh button and when a tool ends while it is shown.
 */
import './cost-monitor.css';
import {
  getUsageDay,
  getUsageSummary,
  listUsageRecords,
  type UsageDayDetail,
  type UsageRange,
  type UsageRecord,
  type UsageSummary,
  type UsageTotal,
} from '../../shared/api/usage';
import { on } from '../../shared/events';
import { toolSettings } from '../../shared/state/tool-settings';
import { isViewMode } from '../../shared/state/view-mode';
import { h, icon, setShown } from '../../shared/ui/dom';
import { button, iconButton } from '../../shared/ui/form';
import { showError, showToast } from '../../shared/ui/toast';
import {
  DEFAULT_RANGE,
  DEFAULT_USD_JPY_RATE,
  RANGE_OPTIONS,
  chartSeries,
  dayKey,
  dayTitle,
  formatCount,
  parseRange,
  parseRate,
  perCallUsd,
  rangeName,
  toSeriesDays,
} from '../../shared/utils/usage';
import { barList } from './bar-list';
import { createDailyChart } from './daily-chart';
import { renderDayDetail } from './day-detail';
import {
  amount,
  costCell,
  dateTime,
  modelLabel,
  modelTable,
  numCell,
  outputTokens,
  statusTags,
  table,
  tagsCell,
  textCell,
} from './parts';

const HISTORY_PAGE = 50;
const AI_STUDIO_SPEND_URL = 'https://aistudio.google.com/spend';
const AI_STUDIO_BILLING_URL = 'https://aistudio.google.com/billing';
/** Color for a tool that is not among the period's chart series (it appears only in an older day). */
const NEUTRAL_COLOR = 'cost-chart__s-none';

const NO_USAGE: UsageTotal = {
  count: 0,
  cost_usd: 0,
  unpriced: 0,
  estimated: 0,
  input_tokens: 0,
  cached_tokens: 0,
  output_text_tokens: 0,
  output_image_tokens: 0,
  thought_tokens: 0,
  search_queries: 0,
  images: 0,
};

export function createCostMonitor(): HTMLElement {
  const settings = toolSettings('costMonitor');
  /** null until the first load (the empty state waits for it, so it does not flash). */
  let summary: UsageSummary | null = null;
  let dayDetail: UsageDayDetail | null = null;
  /** History pages loaded so far (newest first) and the number of records in all. */
  let history: UsageRecord[] = [];
  let historyTotal = 0;
  let rate = DEFAULT_USD_JPY_RATE;
  let range: UsageRange = DEFAULT_RANGE;
  /** The day shown in the detail (today until a bar is clicked). */
  let selectedDay = dayKey(new Date());
  let loadToken = 0;
  let dayToken = 0;

  // ── Header: title, exchange rate, refresh ──
  const rateInput = h('input', {
    class: 'cs-input cost-monitor__rate-input',
    type: 'number',
    min: '0.01',
    step: '0.01',
    title: '円換算のレート（1 USD あたりの円）',
  });
  rateInput.addEventListener('change', () => {
    const value = parseRate(rateInput.value);
    if (value === null) {
      showToast('為替レートには 0 より大きい数を入力してください', 'warning');
      rateInput.value = String(rate);
      return;
    }
    rate = value;
    settings.set('usdJpyRate', String(value));
    void settings.save(['usdJpyRate']);
    render();
  });
  const header = h(
    'div',
    { class: 'cost-monitor__header' },
    h(
      'div',
      { class: 'cost-monitor__heading' },
      h('h1', { class: 'cost-monitor__title', text: 'Cost Monitor' }),
      h('span', { class: 'cost-monitor__subtitle', text: 'Gemini API の利用料' }),
    ),
    h('label', { class: 'cost-monitor__rate' }, h('span', { text: '1 USD =' }), rateInput, h('span', { text: '円' })),
    iconButton('refresh', '再読み込み', () => void load(), 18),
  );

  // ── Period: one row above everything it scopes ──
  const rangeButtons = RANGE_OPTIONS.map(o =>
    h('button', {
      class: 'cost-range__btn',
      text: o.label,
      type: 'button',
      onclick: () => {
        if (range === o.value) return;
        range = o.value;
        settings.set('range', o.value);
        void settings.save(['range']);
        void load();
      },
    }),
  );
  const rangeDates = h('span', { class: 'cost-monitor__muted' });
  const rangeBar = h(
    'div',
    { class: 'cost-range' },
    h('span', { class: 'cost-range__label', text: '期間' }),
    h('div', { class: 'cost-range__group', attrs: { role: 'group', 'aria-label': '期間' } }, ...rangeButtons),
    rangeDates,
  );

  // ── このアプリで使った分 ──
  const tiles = h('div', { class: 'cost-monitor__tiles' });
  const empty = h(
    'div',
    { class: 'cost-monitor__empty' },
    icon('browse_activity', 32),
    h('div', { text: 'まだ Gemini を使った記録はありません' }),
    h('div', {
      class: 'cost-monitor__muted',
      text: 'Nano Banana画像生成・コマ分割を実行すると、ここに利用料が表示されます。',
    }),
  );
  const chart = createDailyChart(day => void selectDay(day));
  const chartTitle = h('h3', { class: 'cost-monitor__card-title' });
  const chartCard = h(
    'div',
    { class: 'cost-monitor__card' },
    h(
      'div',
      { class: 'cost-monitor__card-head' },
      chartTitle,
      h('span', { class: 'cost-monitor__muted', text: '棒をクリックすると、その日の内訳を下に表示します' }),
    ),
    chart.el,
  );
  const toolCard = h('div', { class: 'cost-monitor__card' });
  const modelCard = h('div', { class: 'cost-monitor__card' });
  const dayCard = h('div', { class: 'cost-monitor__card cost-day' });
  const historyCard = h('div', { class: 'cost-monitor__card' });
  const details = h(
    'div',
    { class: 'cost-monitor__details' },
    chartCard,
    h('div', { class: 'cost-monitor__pair' }, toolCard, modelCard),
    dayCard,
    historyCard,
  );
  const appSection = h(
    'section',
    { class: 'cost-monitor__section' },
    h(
      'div',
      { class: 'cost-monitor__section-head' },
      h('h2', { class: 'cost-monitor__section-title', text: 'このアプリで使った分' }),
      h('span', { class: 'cost-monitor__badge', text: 'このPC' }),
    ),
    h('p', {
      class: 'cost-monitor__muted',
      text: 'このアプリから Gemini を呼んだ記録（トークン数）に公式の単価を掛けた額です。実行の直後に反映されます。',
    }),
    tiles,
    empty,
    details,
  );

  // ── Google 側の記録 (not connected) ──
  const googleSection = h(
    'section',
    { class: 'cost-monitor__section' },
    h(
      'div',
      { class: 'cost-monitor__section-head' },
      h('h2', { class: 'cost-monitor__section-title', text: 'Google 側の記録（API キー全体）' }),
      h('span', { class: 'cost-monitor__badge cost-monitor__badge--off', text: '未接続' }),
    ),
    h(
      'div',
      { class: 'cost-monitor__card cost-monitor__google' },
      h('p', {
        text:
          'クレジットの残高と、API キー全体の利用額（ほかの人・ほかの用途の分も含む）は Google AI Studio でのみ確認できます。' +
          'API キーからは読み取れないため、このアプリには表示しません。',
      }),
      h(
        'div',
        { class: 'cost-monitor__links' },
        button('利用額を開く（AI Studio）', () => window.open(AI_STUDIO_SPEND_URL, '_blank', 'noopener'), {
          variant: 'outline',
        }),
        button('残高を開く（AI Studio）', () => window.open(AI_STUDIO_BILLING_URL, '_blank', 'noopener'), {
          variant: 'outline',
        }),
      ),
    ),
  );

  const notes = h('p', { class: 'cost-monitor__notes' });

  const root = h(
    'div',
    { class: 'cost-monitor' },
    h('div', { class: 'cost-monitor__inner' }, header, rangeBar, appSection, googleSection, notes),
  );

  // ── Rendering ──
  const totalNotes = (t: UsageTotal): string[] => [
    ...(t.unpriced ? [`単価未登録 ${t.unpriced} 回を除く`] : []),
    ...(t.estimated ? [`概算 ${t.estimated} 回を含む`] : []),
  ];

  const tile = (label: string, usd: number | null, sub: string[], cls = '') =>
    h(
      'div',
      { class: `cost-monitor__tile ${cls}` },
      h('div', { class: 'cost-monitor__tile-label', text: label }),
      usd === null ? h('div', { class: 'cost-monitor__tile-none', text: '—' }) : amount(usd, rate, 'large'),
      ...sub.map(text => h('div', { class: 'cost-monitor__tile-sub', text })),
    );

  const totalTile = (label: string, t: UsageTotal) =>
    tile(label, t.cost_usd, [[`${formatCount(t.count)} 回`, ...totalNotes(t)].join(' · ')]);

  /** Colors follow the tool: the period's chart series, in fixed order. */
  let colorOf: (tool: string) => string = () => NEUTRAL_COLOR;

  const renderTools = (s: UsageSummary) => {
    const all = s.periods.range;
    const avg = perCallUsd(all);
    toolCard.replaceChildren(
      h('h3', { class: 'cost-monitor__card-title', text: `ツール別の合計（${rangeName(range)}）` }),
      barList(s.by_tool, { rate, colorOf, shares: true }),
      h(
        'div',
        { class: 'cost-bars__overall' },
        h('span', { class: 'cost-bars__overall-label', text: '全体' }),
        amount(all.cost_usd, rate, 'medium'),
        h('span', { class: 'cost-monitor__muted', text: `${formatCount(all.count)} 回` }),
        avg === null ? null : h('span', { class: 'cost-bars__avg' }, '1回平均 ', amount(avg, rate)),
      ),
    );
    modelCard.replaceChildren(
      h('h3', { class: 'cost-monitor__card-title', text: `モデル別（${rangeName(range)}）` }),
      modelTable(s.by_model, rate),
    );
  };

  const renderChart = (s: UsageSummary) => {
    const { series, seriesOf } = chartSeries(s.by_tool.map(r => r.name));
    colorOf = tool => {
      const index = series.indexOf(seriesOf(tool));
      return index === -1 ? NEUTRAL_COLOR : `cost-chart__s${index + 1}`;
    };
    chartTitle.textContent =
      series.length === 1
        ? `日ごとの利用料（${rangeName(range)}・${series[0]}）`
        : `日ごとの利用料（${rangeName(range)}）`;
    chart.update({ days: toSeriesDays(s.daily, seriesOf), series, rate, selected: selectedDay });
  };

  const renderDay = () => {
    if (dayDetail) renderDayDetail(dayCard, dayDetail, rate, colorOf);
  };

  const renderHistory = () => {
    const rest = historyTotal - history.length;
    const more =
      rest > 0 ? button(`さらに ${Math.min(HISTORY_PAGE, rest)} 件表示`, () => void loadMoreHistory()) : null;
    historyCard.replaceChildren(
      h('h3', { class: 'cost-monitor__card-title', text: `すべての履歴（新しい順・全 ${historyTotal} 件）` }),
      table(
        ['日時', 'ツール', 'モデル', '入力', '出力', '思考', '画像', '利用料', ''],
        3,
        history.map(r =>
          h(
            'tr',
            null,
            h('td', { class: 'cost-monitor__nowrap', text: dateTime(r.at) }),
            textCell(r.tool),
            textCell(modelLabel(r.model), r.model),
            numCell(r.usage.input_tokens),
            numCell(outputTokens(r.usage)),
            numCell(r.usage.thought_tokens),
            numCell(r.usage.images),
            costCell(r.cost_usd, rate),
            tagsCell(r),
          ),
        ),
      ),
      ...(more ? [h('div', { class: 'cost-monitor__more' }, more)] : []),
    );
  };

  function render(): void {
    rateInput.value = String(rate);
    rangeButtons.forEach((btn, i) => {
      const active = RANGE_OPTIONS[i].value === range;
      btn.classList.toggle('cost-range__btn--active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    const year = new Date().getFullYear();
    rangeDates.textContent = summary
      ? `${dayTitle(summary.range.start, year)} 〜 ${dayTitle(summary.range.end, year)}（${summary.range.days} 日）`
      : '';
    const periods = summary?.periods ?? { today: NO_USAGE, month: NO_USAGE, range: NO_USAGE };
    const last = summary?.latest ?? null;
    const avg = perCallUsd(periods.range);
    tiles.replaceChildren(
      totalTile('今日', periods.today),
      totalTile('今月', periods.month),
      totalTile(`${rangeName(range)}の合計`, periods.range),
      tile(`1回あたりの平均（${rangeName(range)}）`, avg, [
        avg === null
          ? '単価のわかる実行がありません'
          : `${formatCount(periods.range.count - periods.range.unpriced)} 回の平均`,
      ]),
      ...(last
        ? [
            tile(
              '直前の実行',
              last.cost_usd,
              [`${dateTime(last.at)} · ${last.tool}`, [modelLabel(last.model), ...statusTags(last)].join(' · ')],
              'cost-monitor__tile--latest',
            ),
          ]
        : []),
    );
    const hasRecords = last !== null;
    setShown(empty, summary !== null && !hasRecords);
    setShown(details, hasRecords);
    if (summary && hasRecords) {
      renderChart(summary);
      renderTools(summary);
      renderDay();
      renderHistory();
    }
    notes.textContent =
      `円は入力したレート（1 USD = ${rate} 円）で換算した目安で、Google の実際の換算とは少しずれます。` +
      `単価は ${summary?.prices_checked_on ?? '—'} 時点の Gemini API の公式価格（USD）です。` +
      'Google 検索は月の無料枠を引かずに 1,000 回あたり $14 で計上しています（無料枠はプロジェクト全体で共有のため）。' +
      'キャッシュされた入力も通常の単価で計算しています。1回あたりの平均は単価のわかる実行だけで計算しています。';
  }

  /** Reads the period's totals, the selected day and the first history page again (the previous numbers stay, dimmed). */
  async function load(): Promise<void> {
    const token = ++loadToken;
    const now = new Date();
    root.classList.add('cost-monitor--loading');
    try {
      const [nextSummary, nextDay, page] = await Promise.all([
        getUsageSummary(now, range),
        getUsageDay(selectedDay, now),
        listUsageRecords(0, HISTORY_PAGE),
      ]);
      if (token !== loadToken) return;
      summary = nextSummary;
      dayDetail = nextDay;
      history = page.records;
      historyTotal = page.total;
      render();
    } catch (err) {
      if (token === loadToken) showError('利用記録を読み込めませんでした', err);
    } finally {
      if (token === loadToken) root.classList.remove('cost-monitor--loading');
    }
  }

  async function selectDay(day: string): Promise<void> {
    selectedDay = day;
    if (summary) renderChart(summary);
    const token = ++dayToken;
    dayCard.classList.add('cost-day--loading');
    try {
      const detail = await getUsageDay(day, new Date());
      if (token !== dayToken) return;
      dayDetail = detail;
      renderDay();
      dayCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) {
      if (token === dayToken) showError('この日の利用記録を読み込めませんでした', err);
    } finally {
      if (token === dayToken) dayCard.classList.remove('cost-day--loading');
    }
  }

  async function loadMoreHistory(): Promise<void> {
    const token = loadToken;
    try {
      const page = await listUsageRecords(history.length, HISTORY_PAGE);
      if (token !== loadToken) return;
      // New calls recorded meanwhile shift the pages: skip records already shown.
      const shown = new Set(history.map(r => r.id));
      history = [...history, ...page.records.filter(r => !shown.has(r.id))];
      historyTotal = page.total;
      renderHistory();
    } catch (err) {
      showError('利用記録を読み込めませんでした', err);
    }
  }

  on('cost-mode:toggle', ({ enabled }) => {
    if (!enabled) return;
    rate = parseRate(settings.get('usdJpyRate', String(DEFAULT_USD_JPY_RATE))) ?? DEFAULT_USD_JPY_RATE;
    range = parseRange(settings.get('range', DEFAULT_RANGE));
    selectedDay = dayKey(new Date());
    render();
    void load();
  });
  on('tool:end', () => {
    if (isViewMode('cost')) void load();
  });

  return root;
}
