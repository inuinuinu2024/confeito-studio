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
    expect(emptyCanvasMessage(stateWith(s => (s.sides.left.image = image())))).toBeNull();
    expect(emptyCanvasMessage(stateWith(s => (s.sides.left.text = true)))).toBeNull();
    // Normal mode never shows the document image on its own.
    expect(emptyCanvasMessage(stateWith(s => (s.docImage = image())))).not.toBeNull();
  });

  it('names the folder or the count when Normal mode has no single file selected', () => {
    expect(emptyCanvasMessage(stateWith(s => (s.sides.left.summary = { kind: 'folder', name: 'sub', count: 1 })))).toBe(
      'フォルダ「sub」を選択中です。表示する画像を選択してください',
    );
    expect(emptyCanvasMessage(stateWith(s => (s.sides.left.summary = { kind: 'multiple', count: 3 })))).toBe(
      '3 件を選択中です。Normal モードでは 1 件ずつ表示します',
    );
  });

  it('leaves Parallel mode to the per-pane messages', () => {
    expect(emptyCanvasMessage(stateWith(s => (s.parallel = true)))).toBeNull();
  });

  it('asks for U / T in Overlay mode', () => {
    expect(emptyCanvasMessage(stateWith(s => (s.overlay = true)))).toContain('U: 下絵 / T: 上絵');
    expect(
      emptyCanvasMessage(
        stateWith(s => {
          s.overlay = true;
          s.sides.left.underdrawing = image();
        }),
      ),
    ).toBeNull();
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

  it('asks each empty pane for its own ARCHIVES selection', () => {
    expect(emptyPaneMessage(parallel(), 'left')).toBe('左の ARCHIVES から画像を選択してください');
    expect(emptyPaneMessage(parallel(), 'right')).toBe('右の ARCHIVES から画像を選択してください');
  });

  it('never fills an empty pane with the other image or the document image', () => {
    const s = parallel(s => {
      s.sides.left.image = image();
      s.docImage = image();
    });
    expect(emptyPaneMessage(s, 'left')).toBeNull();
    expect(emptyPaneMessage(s, 'right')).toBe('右の ARCHIVES から画像を選択してください');
    expect(
      emptyPaneMessage(
        parallel(s => (s.sides.right.text = true)),
        'right',
      ),
    ).toBeNull();
  });

  it('names the folder or the count of the pane selection', () => {
    expect(
      emptyPaneMessage(
        parallel(s => (s.sides.right.summary = { kind: 'folder', name: 'sub', count: 1 })),
        'right',
      ),
    ).toBe('フォルダ「sub」を選択中です。表示する画像を選択してください');
    expect(
      emptyPaneMessage(
        parallel(s => (s.sides.left.summary = { kind: 'multiple', count: 2 })),
        'left',
      ),
    ).toBe('2 件を選択中です。各ペインには 1 件ずつ表示します');
  });

  it('is not shown outside Parallel mode', () => {
    expect(emptyPaneMessage(createCanvasState(), 'left')).toBeNull();
  });
});

describe('contentSize', () => {
  it('is the bounding box of both pane images in Parallel mode (actual pixel ratio)', () => {
    const s = stateWith(s => {
      s.parallel = true;
      s.sides.left.image = image(640, 420);
      s.sides.right.image = image(150, 900);
    });
    expect(contentSize(s)).toEqual({ w: 640, h: 900 });
  });

  it('ignores the document image in Parallel mode', () => {
    const s = stateWith(s => {
      s.parallel = true;
      s.docImage = image(2000, 2000);
      s.sides.right.image = image(150, 100);
    });
    expect(contentSize(s)).toEqual({ w: 150, h: 100 });
  });

  it('is the selected image in Normal mode', () => {
    expect(contentSize(stateWith(s => (s.sides.left.image = image(300, 200))))).toEqual({ w: 300, h: 200 });
  });
});

describe('isZoomBarShown', () => {
  it('hides the zoom bar only while text alone is shown', () => {
    expect(isZoomBarShown(createCanvasState())).toBe(true);
    expect(isZoomBarShown(stateWith(s => (s.sides.left.text = true)))).toBe(false);
    expect(
      isZoomBarShown(
        stateWith(s => {
          s.parallel = true;
          s.sides.left.text = true;
          s.sides.right.image = image();
        }),
      ),
    ).toBe(true);
    expect(
      isZoomBarShown(
        stateWith(s => {
          s.parallel = true;
          s.sides.right.text = true;
        }),
      ),
    ).toBe(false);
    expect(isZoomBarShown(stateWith(s => (s.batch = true)))).toBe(false);
  });
});

describe('sliderClip', () => {
  it('keeps the part of the front pane before the divider', () => {
    expect(sliderClip(30, false)).toBe('inset(0 70% 0 0)');
    expect(sliderClip(30, true)).toBe('inset(0 0 70% 0)');
    expect(sliderClip(100, false)).toBe('inset(0 0% 0 0)');
  });
});
