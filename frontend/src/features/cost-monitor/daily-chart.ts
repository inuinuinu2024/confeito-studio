/**
 * Cost Monitor: the cost of each day as stacked bars in yen, one segment per tool (docs/specs/cost-monitor.md).
 * `days` come with their tools already folded into the series (`by_tool` keyed by series, toSeriesDays).
 * SVG redrawn on resize. Each day's whole column is the hover / focus target: hovering shows the day's
 * tooltip, clicking (or Enter / Space) selects the day for the day detail; the selected day stays marked.
 */
import type { UsageDay } from '../../shared/api/usage';
import { h } from '../../shared/ui/dom';
import { dayTitle, formatJpy, formatUsd, jpyNumber, labelEvery } from '../../shared/utils/usage';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 220;
const MARGIN = { top: 12, right: 8, bottom: 24, left: 64 };
/** Surface gap between stacked segments. */
const GAP = 2;
const RADIUS = 4;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Rectangle with rounded top corners (the data end), square at the bottom. */
function topRoundedBar(x: number, y: number, w: number, height: number): string {
  const r = Math.min(RADIUS, w / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + height}Z`;
}

/** A round axis maximum at or above `max` (1, 2, 2.5, 5 × 10^n). */
function niceMax(max: number): number {
  const exp = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * exp >= max) return step * exp;
  return 10 * exp;
}

function shortDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export interface DailyChartData {
  days: UsageDay[];
  series: string[];
  rate: number;
  /** Local day "YYYY-MM-DD" shown in the detail (marked when in the range). */
  selected: string | null;
}

export interface DailyChart {
  el: HTMLElement;
  update(data: DailyChartData): void;
}

export function createDailyChart(onSelect: (day: string) => void): DailyChart {
  const legend = h('div', { class: 'cost-chart__legend' });
  const plot = h('div', { class: 'cost-chart__plot' });
  const tooltip = h('div', { class: 'cost-chart__tooltip', attrs: { role: 'tooltip' } });
  const el = h('div', { class: 'cost-chart' }, legend, plot, tooltip);
  let data: DailyChartData = { days: [], series: [], rate: 1, selected: null };

  const seriesClass = (name: string) => `cost-chart__s${data.series.indexOf(name) + 1}`;
  const year = () => new Date().getFullYear();

  /** Shown beside the day's column (`x` its center, `half` half its width) so it never covers the bar. */
  const showTooltip = (day: UsageDay, x: number, half: number) => {
    const rows = data.series
      .filter(s => day.by_tool[s])
      .map(s =>
        h(
          'div',
          { class: 'cost-chart__tip-row' },
          h('span', { class: `cost-chart__tip-key ${seriesClass(s)}` }),
          h('span', { class: 'cost-chart__tip-value', text: formatJpy(day.by_tool[s], data.rate) }),
          h('span', { class: 'cost-chart__tip-name', text: s }),
        ),
      );
    tooltip.replaceChildren(
      h('div', { class: 'cost-chart__tip-total', text: formatJpy(day.cost_usd, data.rate) }),
      h('div', {
        class: 'cost-chart__tip-day',
        text: `${dayTitle(day.day, year())} · ${day.count} 回 · ${formatUsd(day.cost_usd)}`,
      }),
      ...rows,
      h('div', { class: 'cost-chart__tip-hint', text: 'クリックでこの日の内訳' }),
    );
    tooltip.classList.add('cost-chart__tooltip--shown');
    const tipWidth = tooltip.offsetWidth;
    const left = x > plot.clientWidth / 2 ? x - half - 8 - tipWidth : x + half + 8;
    tooltip.style.left = `${Math.max(left, 0)}px`;
  };
  const hideTooltip = () => tooltip.classList.remove('cost-chart__tooltip--shown');

  const draw = () => {
    const { days, series, rate } = data;
    const width = plot.clientWidth;
    plot.replaceChildren();
    if (width <= 0 || days.length === 0) return;
    // The axis is in yen: round yen steps, not round dollars.
    const maxYen = Math.max(...days.map(d => d.cost_usd)) * rate;
    const yMaxYen = maxYen > 0 ? niceMax(maxYen) : 10;
    const plotW = width - MARGIN.left - MARGIN.right;
    const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
    const slot = plotW / days.length;
    const barW = Math.max(1, Math.min(24, slot * 0.6));
    const yOf = (usd: number) => MARGIN.top + plotH - ((usd * rate) / yMaxYen) * plotH;
    const every = labelEvery(days.length);

    const root = svg('svg', { width, height: HEIGHT, class: 'cost-chart__svg' });
    // Recessive grid: baseline, half and top, labelled in yen.
    for (const yen of [0, yMaxYen / 2, yMaxYen]) {
      const y = yOf(yen / rate);
      root.append(
        svg('line', {
          x1: MARGIN.left,
          x2: width - MARGIN.right,
          y1: y,
          y2: y,
          class: yen === 0 ? 'cost-chart__axis' : 'cost-chart__grid',
        }),
      );
      const label = svg('text', { x: MARGIN.left - 8, y: y + 4, class: 'cost-chart__label', 'text-anchor': 'end' });
      label.textContent = `${jpyNumber(yen / rate, rate)} 円`;
      root.append(label);
    }

    days.forEach((day, i) => {
      const cx = MARGIN.left + slot * i + slot / 2;
      const selected = day.day === data.selected;
      const highlight = svg('rect', {
        x: cx - slot / 2,
        y: MARGIN.top,
        width: slot,
        height: plotH,
        class: `cost-chart__hover${selected ? ' cost-chart__hover--selected' : ''}`,
      });
      root.append(highlight);
      // Segments bottom to top in series order; the top one gets the rounded data end.
      const present = series.filter(s => day.by_tool[s] > 0);
      let base = 0;
      present.forEach((s, k) => {
        const top = base + day.by_tool[s];
        const yTop = yOf(top);
        const yBottom = yOf(base) - (k > 0 ? GAP : 0);
        const segH = Math.max(yBottom - yTop, 1);
        const x = cx - barW / 2;
        const shape =
          k === present.length - 1
            ? svg('path', { d: topRoundedBar(x, yTop, barW, segH), class: seriesClass(s) })
            : svg('rect', { x, y: yTop, width: barW, height: segH, class: seriesClass(s) });
        root.append(shape);
        base = top;
      });
      // Labels counted back from today (the last day), about 8 whatever the period.
      if ((days.length - 1 - i) % every === 0) {
        const label = svg('text', {
          x: cx,
          y: HEIGHT - 6,
          class: `cost-chart__label${selected ? ' cost-chart__label--selected' : ''}`,
          'text-anchor': 'middle',
        });
        label.textContent = i === days.length - 1 ? '今日' : shortDay(day.day);
        root.append(label);
      }
      // The whole column is the hit target, larger than the bar.
      const hit = svg('rect', {
        x: cx - slot / 2,
        y: MARGIN.top,
        width: slot,
        height: plotH,
        class: 'cost-chart__hit',
        tabindex: 0,
        role: 'button',
        'aria-pressed': String(selected),
        'aria-label': `${dayTitle(day.day, year())} ${formatJpy(day.cost_usd, rate)}`,
      });
      const enter = () => {
        highlight.classList.add('cost-chart__hover--on');
        showTooltip(day, cx, slot / 2);
      };
      const leave = () => {
        highlight.classList.remove('cost-chart__hover--on');
        hideTooltip();
      };
      hit.addEventListener('pointerenter', enter);
      hit.addEventListener('pointerleave', leave);
      hit.addEventListener('focus', enter);
      hit.addEventListener('blur', leave);
      hit.addEventListener('click', () => onSelect(day.day));
      hit.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onSelect(day.day);
      });
      root.append(hit);
    });
    plot.append(root);
  };

  new ResizeObserver(draw).observe(plot);

  return {
    el,
    update(next) {
      data = next;
      // A legend for two or more series; a single tool is named by the card title.
      legend.replaceChildren(
        ...(next.series.length >= 2
          ? next.series.map(s =>
              h(
                'span',
                { class: 'cost-chart__legend-item' },
                h('span', { class: `cost-chart__swatch ${seriesClass(s)}` }),
                s,
              ),
            )
          : []),
      );
      hideTooltip();
      draw();
    },
  };
}
