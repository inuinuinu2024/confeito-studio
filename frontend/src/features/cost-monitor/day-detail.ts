/**
 * Cost Monitor: the detail of the day selected on the chart (docs/specs/cost-monitor.md) — its total,
 * the cost per tool (bars with shares), per model, and every run of the day.
 */
import type { UsageDayDetail } from '../../shared/api/usage';
import { h } from '../../shared/ui/dom';
import { dayTitle } from '../../shared/utils/usage';
import { barList } from './bar-list';
import {
  amount,
  costCell,
  modelLabel,
  modelTable,
  numCell,
  outputTokens,
  table,
  tagsCell,
  textCell,
  timeOfDay,
} from './parts';

export function renderDayDetail(
  container: HTMLElement,
  detail: UsageDayDetail,
  rate: number,
  colorOf: (tool: string) => string,
): void {
  const { total } = detail;
  const head = h(
    'div',
    { class: 'cost-day__head' },
    h('h3', { class: 'cost-monitor__card-title', text: `${dayTitle(detail.day, new Date().getFullYear())} の内訳` }),
    h(
      'div',
      { class: 'cost-day__total' },
      amount(total.unpriced === total.count && total.count > 0 ? null : total.cost_usd, rate, 'medium'),
      h('span', { class: 'cost-monitor__muted', text: `${total.count} 回` }),
    ),
  );
  if (total.count === 0) {
    container.replaceChildren(
      head,
      h('p', { class: 'cost-monitor__muted', text: 'この日は Gemini を使っていません。' }),
    );
    return;
  }
  container.replaceChildren(
    head,
    h(
      'div',
      { class: 'cost-day__grid' },
      h(
        'div',
        null,
        h('h4', { class: 'cost-day__subtitle', text: 'ツール別' }),
        barList(detail.by_tool, { rate, colorOf, shares: true }),
      ),
      h('div', null, h('h4', { class: 'cost-day__subtitle', text: 'モデル別' }), modelTable(detail.by_model, rate)),
    ),
    h('h4', { class: 'cost-day__subtitle', text: `実行一覧（新しい順・${detail.records.length} 件）` }),
    table(
      ['時刻', 'ツール', 'モデル', '入力', '出力', '思考', '画像', '利用料', ''],
      3,
      detail.records.map(r =>
        h(
          'tr',
          null,
          h('td', { class: 'cost-monitor__nowrap', text: timeOfDay(r.at) }),
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
  );
}
