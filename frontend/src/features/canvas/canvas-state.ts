/**
 * Mutable state of the canvas area. Owned by Canvas.ts and passed to the pure-ish
 * renderer (render.ts) and the zoom controller (zoom.ts).
 *
 * "left"/"right" are the two panes: the left pane shows the image selected in the left
 * ARCHIVES panel; the right pane is only visible in Compare mode.
 */

export type Side = 'left' | 'right';

export interface SideState {
  /** Image selected in the ARCHIVES panel of this side (T in Overlay mode). */
  image: HTMLCanvasElement | null;
  /** A text file (json/txt/md) is shown in this side's text overlay instead of an image. */
  text: boolean;
  /** Overlay mode underdrawing (U). */
  underdrawing: HTMLCanvasElement | null;
  /** Overlay mode: offset of the top image (T) dragged by the user, in canvas pixels. */
  topOffset: { x: number; y: number };
  /** Overlay mode: T is selected (double click) and can be moved with drag / arrow keys. */
  topSelected: boolean;
}

export interface BatchImage {
  key: string;
  name: string;
  canvas: HTMLCanvasElement | null;
}

export interface CanvasState {
  /** Mirrors of the view mode, updated in the order the toggle events arrive. */
  compare: boolean;
  overlay: boolean;
  batch: boolean;
  /** Compare mode sub-options: slider (wipe) view, vertical split, swapped sides. */
  slider: boolean;
  vertical: boolean;
  flipped: boolean;
  splitPct: number;

  /** DocumentManager's current image (last `document:loaded`). */
  docImage: HTMLCanvasElement | null;
  /** Size the canvases were created with (document image, or the batch grid). */
  baseW: number;
  baseH: number;
  /** Current pixel size of both canvases (bounding box of everything shown). */
  drawW: number;
  drawH: number;
  /** Percent; 100 = fit to the available area (see zoom.ts). */
  zoom: number;

  /** CSS colour or "checkerboard" / "transparent". */
  bgColor: string;
  /** Overlay tint id ("blue" | "green" | "red" | "gray") or null for the original colours. */
  tint: string | null;
  /** Opacity of T in percent. */
  topOpacity: number;

  sides: Record<Side, SideState>;
  batchImages: BatchImage[];
}

const emptySide = (): SideState => ({
  image: null,
  text: false,
  underdrawing: null,
  topOffset: { x: 0, y: 0 },
  topSelected: false,
});

export function createCanvasState(): CanvasState {
  return {
    compare: false,
    overlay: false,
    batch: false,
    slider: false,
    vertical: false,
    flipped: false,
    splitPct: 50,
    docImage: null,
    baseW: 0,
    baseH: 0,
    drawW: 0,
    drawH: 0,
    zoom: 100,
    bgColor: 'checkerboard',
    tint: 'blue',
    topOpacity: 50,
    sides: { left: emptySide(), right: emptySide() },
    batchImages: [],
  };
}

/** Whether a text overlay is visible (either side in Compare mode, otherwise the left one). */
export function isTextActive(s: CanvasState): boolean {
  return s.compare ? s.sides.left.text || s.sides.right.text : s.sides.left.text;
}

/** Canvas size for the current mode: the selected image, or the bounding box of everything shown. */
export function contentSize(s: CanvasState): { w: number; h: number } {
  const docW = s.docImage?.width ?? 0;
  const docH = s.docImage?.height ?? 0;
  if (s.batch) return { w: s.baseW, h: s.baseH };
  if (!s.overlay && !s.compare && !s.slider) {
    const image = s.sides.left.image;
    return image ? { w: image.width, h: image.height } : { w: docW, h: docH };
  }
  const images = [s.sides.left.image, s.sides.right.image, s.sides.left.underdrawing, s.sides.right.underdrawing];
  return images.reduce(
    (size, img) => (img ? { w: Math.max(size.w, img.width), h: Math.max(size.h, img.height) } : size),
    { w: docW, h: docH },
  );
}
