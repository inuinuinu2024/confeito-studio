import { describe, expect, it } from 'vitest';
import {
  type CanvasState,
  contentSize,
  createCanvasState,
  emptyCanvasMessage,
  emptyPaneMessage,
  isZoomBarShown,
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
  it('asks for an image in Normal mode until an image or text file is shown', () => {
    expect(emptyCanvasMessage(createCanvasState())).toBe('ARCHIVES から画像を選択してください');
    expect(emptyCanvasMessage(stateWith(s => (s.selection.image = image())))).toBeNull();
    expect(emptyCanvasMessage(stateWith(s => (s.selection.text = true)))).toBeNull();
    // Normal mode never shows the document image on its own.
    expect(emptyCanvasMessage(stateWith(s => (s.docImage = image())))).not.toBeNull();
  });

  it('names the folder or the count when Normal mode has no single file selected', () => {
    expect(emptyCanvasMessage(stateWith(s => (s.selection.summary = { kind: 'folder', name: 'sub', count: 1 })))).toBe(
      'フォルダ「sub」を選択中です。表示する画像を選択してください',
    );
    expect(emptyCanvasMessage(stateWith(s => (s.selection.summary = { kind: 'multiple', count: 3 })))).toBe(
      '3 件を選択中です。Normal モードでは 1 件ずつ表示します',
    );
  });

  it('leaves Parallel mode to the per-pane messages', () => {
    expect(emptyCanvasMessage(stateWith(s => (s.parallel = true)))).toBeNull();
  });

  it('asks for U / T in Overlay mode until one of them is set', () => {
    const overlay = (update: (s: CanvasState) => void = () => {}) =>
      emptyCanvasMessage(
        stateWith(s => {
          s.overlay = true;
          update(s);
        }),
      );
    expect(overlay()).toBe('ARCHIVES の U / T 列で重ね合わせる画像（U: 下絵 / T: 上絵）を選択してください');
    expect(overlay(s => (s.layers.under = image()))).toBeNull();
    expect(overlay(s => (s.layers.top = image()))).toBeNull();
    // The ARCHIVES selection (image, text file or document) is not shown in Overlay mode.
    expect(
      overlay(s => {
        s.selection.image = s.docImage = image();
        s.selection.text = true;
      }),
    ).not.toBeNull();
  });

  it('asks for an image or folder in Batch mode until a grid image is loaded', () => {
    const batch = (images: CanvasState['batchImages']) =>
      emptyCanvasMessage(
        stateWith(s => {
          s.batch = true;
          s.batchImages = images;
        }),
      );
    expect(batch([])).toBe('ARCHIVES から画像またはフォルダを選択してください');
    expect(batch([{ key: 'a/x.png', name: 'x.png', canvas: null }])).not.toBeNull();
    expect(batch([{ key: 'a/x.png', name: 'x.png', canvas: image() }])).toBeNull();
  });
});

describe('emptyPaneMessage', () => {
  const parallel = (update: (s: CanvasState) => void = () => {}) =>
    stateWith(s => {
      s.parallel = true;
      update(s);
    });

  it('asks each empty pane for its L / R column', () => {
    expect(emptyPaneMessage(parallel(), 'left')).toBe('ARCHIVES の L 列で左に表示する画像を選択してください');
    expect(emptyPaneMessage(parallel(), 'right')).toBe('ARCHIVES の R 列で右に表示する画像を選択してください');
  });

  it('never fills an empty pane with the other layer, the selection or the document image', () => {
    const s = parallel(s => {
      s.layers.left = image();
      s.selection.image = s.docImage = image();
    });
    expect(emptyPaneMessage(s, 'left')).toBeNull();
    expect(emptyPaneMessage(s, 'right')).toBe('ARCHIVES の R 列で右に表示する画像を選択してください');
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

  it('ignores the selection and the document image in Parallel mode', () => {
    const s = stateWith(s => {
      s.parallel = true;
      s.selection.image = s.docImage = image(2000, 2000);
      s.layers.right = image(150, 100);
    });
    expect(contentSize(s)).toEqual({ w: 150, h: 100 });
  });

  it('is the bounding box of U and T in Overlay mode (not the selection or the document)', () => {
    const s = stateWith(s => {
      s.overlay = true;
      s.layers.under = image(800, 1200);
      s.layers.top = image(1000, 600);
      s.selection.image = s.docImage = image(3000, 3000);
    });
    expect(contentSize(s)).toEqual({ w: 1000, h: 1200 });
    expect(contentSize(stateWith(s => (s.overlay = true)))).toEqual({ w: 0, h: 0 });
  });

  it('is the selected image in Normal mode', () => {
    expect(contentSize(stateWith(s => (s.selection.image = image(300, 200))))).toEqual({ w: 300, h: 200 });
  });
});

describe('isZoomBarShown', () => {
  it('hides the zoom bar only while a text file is shown in Normal mode, and in Batch mode', () => {
    expect(isZoomBarShown(createCanvasState())).toBe(true);
    expect(isZoomBarShown(stateWith(s => (s.selection.text = true)))).toBe(false);
    expect(isZoomBarShown(stateWith(s => (s.batch = true)))).toBe(false);
  });

  it('shows the zoom bar in Parallel / Overlay mode even with a text file selected (it is not shown there)', () => {
    for (const mode of ['parallel', 'overlay'] as const) {
      expect(
        isZoomBarShown(
          stateWith(s => {
            s[mode] = true;
            s.selection.text = true;
          }),
        ),
      ).toBe(true);
    }
  });
});

describe('sliderClip', () => {
  it('keeps the part of the front pane before the divider', () => {
    expect(sliderClip(30, false)).toBe('inset(0 70% 0 0)');
    expect(sliderClip(30, true)).toBe('inset(0 0 70% 0)');
    expect(sliderClip(100, false)).toBe('inset(0 0% 0 0)');
  });
});
