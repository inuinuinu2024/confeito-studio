/**
 * Cost Monitor building blocks shared by the dashboard and the day detail: amounts (yen first, USD second),
 * tables and the labels of a record. Yen are converted at the rate the user entered (docs/specs/cost-monitor.md).
 */
import type { UsageBreakdownRow, UsageRecord } from '../../shared/api/usage';
import { h } from '../../shared/ui/dom';
import { formatCount, formatUsd, jpyNumber, perCallUsd } from '../../shared/utils/usage';
import { IMAGE_MODELS } from '../tools/nano-banana-pro/models';

/** "Nano Banana Pro" for the image models, the model id otherwise. */
export function modelLabel(id: string): string {
  return IMAGE_MODELS.find(m => m.id === id)?.nickname ?? id;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "10/4 14:32" in local time. */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "14:32" in local time. */
export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function outputTokens(u: { output_text_tokens: number; output_image_tokens: number }): number {
  return u.output_text_tokens + u.output_image_tokens;
}

/** Things worth knowing about one record, as short tags. */
export function statusTags(r: UsageRecord): string[] {
  return [
    ...(r.status === 'no_output' ? ['結果なし（入力分は課金）'] : []),
    ...(r.estimated ? ['概算'] : []),
    ...(r.service_tier !== 'standard' ? [r.service_tier] : []),
  ];
}

/**
 * An amount with the yen first: "約 37 円" (the number large in the "large" size) and "$0.244" after it.
 * null = no listed price.
 */
export function amount(usd: number | null, rate: number, size: 'large' | 'medium' | 'small' = 'small'): HTMLElement {
  if (usd === null) return h('span', { class: 'cost-monitor__muted', text: '単価未登録' });
  return h(
    'span',
    { class: `cost-amount cost-amount--${size}` },
    h(
      'span',
      { class: 'cost-amount__jpy' },
      usd === 0 ? '' : h('span', { class: 'cost-amount__approx', text: '約' }),
      h('span', { class: 'cost-amount__yen', text: jpyNumber(usd, rate) }),
      h('span', { class: 'cost-amount__unit', text: '円' }),
    ),
    h('span', { class: 'cost-amount__usd', text: formatUsd(usd) }),
  );
}

/** The cost of a breakdown row, or null when none of its calls has a price. */
export function rowCost(r: UsageBreakdownRow): number | null {
  return r.unpriced === r.count ? null : r.cost_usd;
}

/** A table whose first `textColumns` columns are text (left aligned) and the rest numbers. */
export function table(head: string[], textColumns: number, rows: HTMLElement[]): HTMLElement {
  return h(
    'div',
    { class: 'cost-monitor__table-wrap' },
    h(
      'table',
      { class: 'cost-monitor__table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          ...head.map((text, i) => h('th', { text, class: i < textColumns ? 'cost-monitor__th-text' : '' })),
        ),
      ),
      h('tbody', null, ...rows),
    ),
  );
}

export function numCell(n: number): HTMLElement {
  return h('td', { class: 'cost-monitor__num', text: formatCount(n) });
}

export function costCell(usd: number | null, rate: number): HTMLElement {
  return h('td', { class: 'cost-monitor__num' }, amount(usd, rate));
}

export function textCell(text: string, title?: string): HTMLElement {
  return h('td', { class: 'cost-monitor__name', text, title: title ?? '' });
}

export function tagsCell(r: UsageRecord): HTMLElement {
  return h(
    'td',
    { class: 'cost-monitor__tags' },
    ...statusTags(r).map(text => h('span', { class: 'cost-monitor__tag', text })),
  );
}

/** Per model: calls, tokens, images, cost and the average of one call. */
export function modelTable(rows: UsageBreakdownRow[], rate: number): HTMLElement {
  return table(
    ['モデル', '回数', '入力', '出力', '思考', '画像', '利用料', '1回平均'],
    1,
    rows.map(r => {
      const avg = perCallUsd(r);
      return h(
        'tr',
        null,
        textCell(modelLabel(r.name), r.name),
        numCell(r.count),
        numCell(r.input_tokens),
        numCell(outputTokens(r)),
        numCell(r.thought_tokens),
        numCell(r.images),
        costCell(rowCost(r), rate),
        costCell(avg, rate),
      );
    }),
  );
}
