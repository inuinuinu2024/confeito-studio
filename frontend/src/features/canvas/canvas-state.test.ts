import { describe, expect, it } from 'vitest';
import {
  type CanvasState,
  CHOOSE_IN_NORMAL,
  contentSize,
  createCanvasState,
  emptyCanvasMessage,
  emptyPaneMessage,
  sliderClip,
} from './canvas-state';

// Only presence and size matter (vitest runs without a DOM).
const image = (width = 10, height = 10) => ({ width, height }) as HTMLCanvasElement;

function stateWith(update: (s: CanvasState) => void): CanvasState {
  const s = createCanvasState();
  update(s);
  return s;
}

describe('emptyCanvasMessage', () => {
  it('leaves Parallel mode to the per-pane messages', () => {
    expect(emptyCanvasMessage(stateWith(s => (s.parallel = true)))).toBeNull();
  });

  it('says how to choose U / T in Overlay mode until one of them is set', () => {
    const overlay = (update: (s: CanvasState) => void = () => {}) =>
      emptyCanvasMessage(
        stateWith(s => {
          s.overlay = true;
          update(s);
        }),
      );
    expect(overlay()).toBe(`重ね合わせる画像がありません。${CHOOSE_IN_NORMAL}`);
    expect(overlay(s => (s.layers.under = image()))).toBeNull();
    expect(overlay(s => (s.layers.top = image()))).toBeNull();
  });
});

describe('emptyPaneMessage', () => {
  const parallel = (update: (s: CanvasState) => void = () => {}) =>
    stateWith(s => {
      s.parallel = true;
      update(s);
    });

  it('says how to choose the image of each empty pane', () => {
    expect(emptyPaneMessage(parallel(), 'left')).toBe(`左に表示する画像がありません。${CHOOSE_IN_NORMAL}`);
    expect(emptyPaneMessage(parallel(), 'right')).toBe(
      '右に表示する画像がありません。2 枚選択すると 2 枚目を右に表示します',
    );
  });

  it('never fills an empty pane with the other layer', () => {
    const s = parallel(s => (s.layers.left = image()));
    expect(emptyPaneMessage(s, 'left')).toBeNull();
    expect(emptyPaneMessage(s, 'right')).not.toBeNull();
  });

  it('is not shown outside Parallel mode', () => {
    expect(emptyPaneMessage(createCanvasState(), 'left')).toBeNull();
  });
});

describe('contentSize', () => {
  it('is the bounding box of L and R in Parallel mode (actual pixel ratio)', () => {
    const s = stateWith(s => {
      s.parallel = true;
      s.layers.left = image(640, 420);
      s.layers.right = image(150, 900);
    });
    expect(contentSize(s)).toEqual({ w: 640, h: 900 });
  });

  it('is the bounding box of U and T in Overlay mode', () => {
    const s = stateWith(s => {
      s.overlay = true;
      s.layers.under = image(800, 1200);
      s.layers.top = image(1000, 600);
    });
    expect(contentSize(s)).toEqual({ w: 1000, h: 1200 });
    expect(contentSize(stateWith(s => (s.overlay = true)))).toEqual({ w: 0, h: 0 });
  });

  it('is empty outside the comparison modes', () => {
    expect(contentSize(stateWith(s => (s.layers.left = image(300, 200))))).toEqual({ w: 0, h: 0 });
  });
});

describe('sliderClip', () => {
  it('keeps the part of the front pane before the divider', () => {
    expect(sliderClip(30, false)).toBe('inset(0 70% 0 0)');
    expect(sliderClip(30, true)).toBe('inset(0 0 70% 0)');
    expect(sliderClip(100, false)).toBe('inset(0 0% 0 0)');
  });
});
