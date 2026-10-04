import { describe, expect, it } from 'vitest';
import { defaultCrop, faceCrop, moveCrop, resizeCrop } from './icon-crop';

describe('icon crop frame', () => {
  it('surrounds a face with a margin, inside the image', () => {
    expect(faceCrop({ x: 100, y: 100, width: 50, height: 100 }, 1000, 1000)).toEqual({ x: 45, y: 70, size: 160 });
    // Near the edge: moved inside.
    expect(faceCrop({ x: 0, y: 0, width: 50, height: 50 }, 1000, 1000)).toEqual({ x: 0, y: 0, size: 80 });
    // A face as large as the image: no larger than the short side.
    expect(faceCrop({ x: 0, y: 0, width: 400, height: 300 }, 400, 300)).toEqual({ x: 50, y: 0, size: 300 });
  });

  it('starts in the middle without a face', () => {
    expect(defaultCrop(1000, 500)).toEqual({ x: 350, y: 100, size: 300 });
    expect(defaultCrop(10, 10)).toEqual({ x: 0, y: 0, size: 10 });
  });

  it('moves inside the image', () => {
    expect(moveCrop({ x: 10, y: 10, size: 100 }, 50, -30, 200, 200)).toEqual({ x: 60, y: 0, size: 100 });
    expect(moveCrop({ x: 10, y: 10, size: 100 }, 500, 500, 200, 200)).toEqual({ x: 100, y: 100, size: 100 });
  });

  it('resizes from a corner, keeping the opposite corner and the square', () => {
    const crop = { x: 100, y: 100, size: 100 };
    expect(resizeCrop(crop, 'se', 260, 220, 1000, 1000)).toEqual({ x: 100, y: 100, size: 160 });
    expect(resizeCrop(crop, 'nw', 50, 80, 1000, 1000)).toEqual({ x: 50, y: 50, size: 150 });
    // Not past the image edge, not under 16px.
    expect(resizeCrop(crop, 'nw', -500, -500, 1000, 1000)).toEqual({ x: 0, y: 0, size: 200 });
    expect(resizeCrop(crop, 'ne', 101, 199, 1000, 1000)).toEqual({ x: 100, y: 184, size: 16 });
  });
});
