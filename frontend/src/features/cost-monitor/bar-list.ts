/**
 * Cost Monitor: totals as horizontal bars, one row per tool (docs/specs/cost-monitor.md). Each row names its
 * tool directly (no legend), the bar length is the cost relative to the largest row, and the numbers beside
 * it are the cost (yen first), the calls, the average of one call and, when asked, the share.
 */
import type { UsageBreakdownRow } from '../../shared/api/usage';
import { h } from '../../shared/ui/dom';
import { formatCount, formatShare, perCallUsd } from '../../shared/utils/usage';
import { amount, rowCost } from './parts';

export interface BarListOptions {
  rate: number;
  /** CSS class giving the row's series color (cost-chart__s1…). */
  colorOf: (name: string) => string;
  /** Show each row's share of the total cost. */
  shares?: boolean;
}

export function barList(rows: UsageBreakdownRow[], opts: BarListOptions): HTMLElement {
  const max = Math.max(0, ...rows.map(r => r.cost_usd));
  const total = rows.reduce((sum, r) => sum + r.cost_usd, 0);
  return h(
    'div',
    { class: 'cost-bars' },
    ...rows.map(r => {
      const avg = perCallUsd(r);
      const width = max > 0 ? Math.max((r.cost_usd / max) * 100, r.cost_usd > 0 ? 1 : 0) : 0;
      const facts = [
        `${formatCount(r.count)} 回`,
        ...(opts.shares ? [formatShare(r.cost_usd, total)] : []),
        ...(r.unpriced ? [`単価未登録 ${r.unpriced} 回`] : []),
      ];
      return h(
        'div',
        { class: 'cost-bars__row' },
        h('div', { class: 'cost-bars__name', text: r.name }),
        h(
          'div',
          { class: 'cost-bars__track' },
          h('div', { class: `cost-bars__bar ${opts.colorOf(r.name)}`, style: { width: `${width}%` } }),
        ),
        h('div', { class: 'cost-bars__cost' }, amount(rowCost(r), opts.rate, 'medium')),
        h(
          'div',
          { class: 'cost-bars__facts' },
          h('span', { text: facts.join(' · ') }),
          avg === null ? null : h('span', { class: 'cost-bars__avg' }, '1回平均 ', amount(avg, opts.rate)),
        ),
      );
    }),
  );
}
