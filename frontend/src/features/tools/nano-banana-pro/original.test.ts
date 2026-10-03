import { describe, expect, it } from 'vitest';
import { findModel } from './models';
import { UNSET } from './options';
import { autoAspectRatio, expectedOutputSize, originalHeading, originalLayout, restoreCrop } from './original';

const pro = findModel('gemini-3-pro-image');
const flash = findModel('gemini-3.1-flash-image');
const legacy = findModel('gemini-2.5-flash-image');

describe('original image', () => {
  it('picks the aspect ratio closest to the original by the real output pixels', () => {
    // A4 portrait (0.707): 2:3 = 848x1264 (0.671) is closer than 3:4 = 896x1200 (0.747).
    expect(autoAspectRatio(2480, 3508, pro)).toBe('2:3');
    expect(autoAspectRatio(3508, 2480, pro)).toBe('3:2');
    expect(autoAspectRatio(500, 500, pro)).toBe('1:1');
    // A very tall image: Nano Banana 2 has 1:8, Pro stops at 9:16.
    expect(autoAspectRatio(100, 800, flash)).toBe('1:8');
    expect(autoAspectRatio(100, 800, pro)).toBe('9:16');
    // Fixed-size model: its own table (3:2 = 1248x832).
    expect(autoAspectRatio(1500, 1000, legacy)).toBe('3:2');
  });

  it('treats an unset image size as 1K', () => {
    expect(expectedOutputSize(pro, '2:3', UNSET)).toEqual([848, 1264]);
    expect(expectedOutputSize(pro, '2:3', '2K')).toEqual([1696, 2528]);
  });

  it('centres the original on a canvas of the output ratio with white padding', () => {
    const layout = originalLayout(300, 420, [848, 1264]);
    expect(layout.sent).toEqual([848, 1264]);
    expect(layout.content).toEqual({ x: 0, y: 38, w: 848, h: 1187 });
    expect(layout.padding).toBe('vertical');
    expect(layout.rect.y).toBeCloseTo(38 / 1264);

    // Narrower than 16:9 -> padding left and right.
    const wide = originalLayout(1000, 700, [1376, 768]);
    expect(wide.padding).toBe('horizontal');
    expect(wide.content.h).toBe(768);
    expect(wide.content.x * 2 + wide.content.w).toBeLessThanOrEqual(1376);

    expect(originalLayout(512, 512, [1024, 1024]).padding).toBe('none');
  });

  it('caps the longest side of the sent image', () => {
    const layout = originalLayout(2480, 3508, [3392, 5056]);
    expect(layout.sent).toEqual([1374, 2048]);
  });

  it('cuts the same part out of the generated image whatever size it comes back at', () => {
    const { rect } = originalLayout(300, 420, [848, 1264]);
    expect(restoreCrop(rect, 848, 1264)).toEqual({ x: 0, y: 38, w: 848, h: 1187 });
    expect(restoreCrop(rect, 1696, 2528)).toEqual({ x: 0, y: 76, w: 1696, h: 2374 });
    // Never outside the image.
    expect(restoreCrop({ x: -0.1, y: 0.5, w: 1.5, h: 0.9 }, 100, 100)).toEqual({ x: 0, y: 50, w: 100, h: 50 });
  });

  it('describes the original and its padding in the prompt', () => {
    expect(originalHeading(3, 'vertical')).toBe(
      '# Image 3（原画）\n' +
        'この画像を原画とする。出力はこの原画を書き直した画像にすること。構図・輪郭・各要素の位置と大きさは原画と一致させること。\n' +
        '画像の上下にある白い余白は縦横比を合わせるための詰め物なので、何も描かず白のままにすること。\n\n',
    );
    expect(originalHeading(1, 'horizontal')).toContain('画像の左右にある白い余白');
    expect(originalHeading(1, 'none')).not.toContain('余白');
  });
});
