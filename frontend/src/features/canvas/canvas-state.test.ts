import { describe, expect, it } from 'vitest';
import { type CanvasState, createCanvasState, emptyCanvasMessage } from './canvas-state';

// Only presence matters (vitest runs without a DOM).
const image = () => ({ width: 10, height: 10 }) as HTMLCanvasElement;

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

  it('is empty in Compare mode only when neither pane shows anything', () => {
    expect(emptyCanvasMessage(stateWith(s => (s.compare = true)))).toBe('ARCHIVES から画像を選択してください');
    expect(
      emptyCanvasMessage(
        stateWith(s => {
          s.compare = true;
          s.sides.right.image = image();
        }),
      ),
    ).toBeNull();
    expect(
      emptyCanvasMessage(
        stateWith(s => {
          s.compare = true;
          s.docImage = image(); // shown by a pane without a selection
        }),
      ),
    ).toBeNull();
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
