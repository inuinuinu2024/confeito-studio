import { describe, expect, it } from 'vitest';
import {
  OTHER_SERIES,
  chartSeries,
  dayTitle,
  formatJpy,
  formatShare,
  formatUsd,
  jpyNumber,
  labelEvery,
  parseRange,
  parseRate,
  perCallUsd,
  rangeName,
  toSeriesDays,
} from './usage';

describe('chartSeries', () => {
  it('orders the known tools first and folds past three series into その他', () => {
    const { series, seriesOf } = chartSeries(['Z', 'コマ分割', 'Y', 'Nano Banana画像生成']);
    expect(series).toEqual(['Nano Banana画像生成', 'コマ分割', OTHER_SERIES]);
    expect(seriesOf('Y')).toBe(OTHER_SERIES);
    expect(seriesOf('コマ分割')).toBe('コマ分割');
  });

  it('keeps three tools as their own series', () => {
    expect(chartSeries(['Y', 'コマ分割', 'Y', 'Nano Banana画像生成']).series).toEqual([
      'Nano Banana画像生成',
      'コマ分割',
      'Y',
    ]);
  });
});

describe('toSeriesDays', () => {
  it('sums the folded tools of a day', () => {
    const day = { day: '2026-10-04', by_tool: { A: 0.1, B: 0.2, C: 0.3 }, cost_usd: 0.6, count: 3 };
    const [folded] = toSeriesDays([day], tool => (tool === 'A' ? 'A' : OTHER_SERIES));
    expect(folded.by_tool).toEqual({ A: 0.1, [OTHER_SERIES]: 0.5 });
    expect(folded.cost_usd).toBe(0.6);
  });
});

describe('formats', () => {
  it('shows small USD amounts with enough digits', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0012)).toBe('$0.0012');
    expect(formatUsd(0.1344)).toBe('$0.134');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });

  it('converts to yen at the rate', () => {
    expect(formatJpy(0.134, 150)).toBe('約 20 円');
    expect(formatJpy(0.0012, 150)).toBe('約 0.2 円');
    expect(formatJpy(100, 150)).toBe('約 15,000 円');
    expect(formatJpy(0, 150)).toBe('0 円');
  });

  it('accepts only positive rates', () => {
    expect(parseRate(' 148.5 ')).toBe(148.5);
    expect(parseRate('0')).toBeNull();
    expect(parseRate('abc')).toBeNull();
    expect(parseRate('')).toBeNull();
  });
});

describe('periods', () => {
  it('reads a stored period, falling back to 30 days', () => {
    expect(parseRange('90d')).toBe('90d');
    expect(parseRange('1y')).toBe('30d');
    expect(rangeName('7d')).toBe('直近 7 日');
    expect(rangeName('month')).toBe('今月');
    expect(rangeName('all')).toBe('全期間');
  });

  it('labels about 8 days on the axis', () => {
    expect(labelEvery(7)).toBe(1);
    expect(labelEvery(30)).toBe(4);
    expect(labelEvery(400)).toBe(50);
  });

  it('titles a day with its weekday, and the year when it is another year', () => {
    expect(dayTitle('2026-10-04', 2026)).toBe('10/4（日）');
    expect(dayTitle('2025-12-31', 2026)).toBe('2025/12/31（水）');
  });
});

describe('averages and shares', () => {
  it('averages over the calls with a price', () => {
    expect(perCallUsd({ cost_usd: 0.3, count: 4, unpriced: 1 })).toBeCloseTo(0.1);
    expect(perCallUsd({ cost_usd: 0, count: 2, unpriced: 2 })).toBeNull();
    expect(perCallUsd({ cost_usd: 0, count: 0, unpriced: 0 })).toBeNull();
  });

  it('shows shares as whole percents', () => {
    expect(formatShare(1, 3)).toBe('33%');
    expect(formatShare(0.001, 1)).toBe('1%未満');
    expect(formatShare(0, 0)).toBe('—');
  });

  it('gives the yen number without the unit', () => {
    expect(jpyNumber(10, 150)).toBe('1,500');
    expect(jpyNumber(0.0024, 150)).toBe('0.4');
    expect(jpyNumber(0, 150)).toBe('0');
  });
});
