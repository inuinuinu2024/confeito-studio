import { describe, expect, it } from 'vitest';
import { pickByNames, sortByOrder } from './tool-order';

const tools = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];

describe('sortByOrder', () => {
  it('keeps registry order without a saved order', () => {
    expect(sortByOrder(tools, null).map(t => t.name)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('applies the saved order and appends unknown tools in registry order', () => {
    expect(sortByOrder(tools, ['c', 'a']).map(t => t.name)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('pickByNames', () => {
  it('returns pinned tools in pinned order and skips removed tools', () => {
    expect(pickByNames(tools, ['d', 'x', 'b']).map(t => t.name)).toEqual(['d', 'b']);
  });
});
