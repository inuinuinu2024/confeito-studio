import { describe, expect, it } from 'vitest';
import { boxOfRect, MIN_RECT, moveRect, rectOfBox, resizeRect, sameBox } from './rect-crop';

describe('rect-crop', () => {
  it('converts between boxes and rects', () => {
    expect(rectOfBox([10, 20, 110, 70])).toEqual({ x: 10, y: 20, w: 100, h: 50 });
    expect(boxOfRect({ x: 10.4, y: 19.6, w: 100.2, h: 50 }, 300, 200)).toEqual([10, 20, 111, 70]);
  });

  it('keeps the box inside the image and at least one pixel large', () => {
    expect(boxOfRect({ x: -5, y: -5, w: 400, h: 400 }, 300, 200)).toEqual([0, 0, 300, 200]);
    expect(boxOfRect({ x: 299.8, y: 10, w: 0.1, h: 0.1 }, 300, 200)).toEqual([299, 10, 300, 11]);
  });

  it('compares boxes', () => {
    expect(sameBox([1, 2, 3, 4], [1, 2, 3, 4])).toBe(true);
    expect(sameBox([1, 2, 3, 4], [1, 2, 3, 5])).toBe(false);
  });

  it('moves the frame inside the image', () => {
    const rect = { x: 10, y: 10, w: 100, h: 50 };
    expect(moveRect(rect, 20, 5, 300, 200)).toEqual({ x: 30, y: 15, w: 100, h: 50 });
    expect(moveRect(rect, 500, -50, 300, 200)).toEqual({ x: 200, y: 0, w: 100, h: 50 });
  });

  it('resizes by an edge or a corner, the opposite side staying', () => {
    const rect = { x: 10, y: 10, w: 100, h: 50 };
    expect(resizeRect(rect, 'e', 150, 999, 300, 200)).toEqual({ x: 10, y: 10, w: 140, h: 50 });
    expect(resizeRect(rect, 'n', 999, 0, 300, 200)).toEqual({ x: 10, y: 0, w: 100, h: 60 });
    expect(resizeRect(rect, 'nw', 0, 5, 300, 200)).toEqual({ x: 0, y: 5, w: 110, h: 55 });
    expect(resizeRect(rect, 'se', 400, 400, 300, 200)).toEqual({ x: 10, y: 10, w: 290, h: 190 });
  });

  it('never makes the frame smaller than MIN_RECT', () => {
    const rect = { x: 10, y: 10, w: 100, h: 50 };
    expect(resizeRect(rect, 'w', 500, 0, 300, 200)).toEqual({ x: 110 - MIN_RECT, y: 10, w: MIN_RECT, h: 50 });
    expect(resizeRect(rect, 's', 0, -100, 300, 200)).toEqual({ x: 10, y: 10, w: 100, h: MIN_RECT });
  });
});
