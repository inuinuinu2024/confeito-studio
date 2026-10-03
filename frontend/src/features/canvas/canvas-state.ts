/**
 * Mutable state of the canvas area. Owned by Canvas.ts and passed to the pure-ish
 * renderer (render.ts) and the zoom controller (zoom.ts).
 *
 * "left"/"right" are the two panes: the left pane shows the image selected in the left
 * ARCHIVES panel; the right pane is only visible in Parallel mode.
 */

import type { SelectionSummary } from '../../shared/events';

export type Side = 'left' | 'right';

export interface SideState {
  /** Image selected in the ARCHIVES panel of this side (T in Overlay mode). */
  image: HTMLCanvasElement | null;
  /** A text file (json/txt/md) is shown in this side's text overlay instead of an image. */
  text: boolean;
  /** A folder or several entries are selected on this side: nothing is shown, the empty message says so. */
  summary: SelectionSummary | null;
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
  parallel: boolean;
  overlay: boolean;
  batch: boolean;
  /** Parallel mode sub-options: slider (wipe) view, vertical split, swapped sides. */
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
  summary: null,
  underdrawing: null,
  topOffset: { x: 0, y: 0 },
  topSelected: false,
});

export function createCanvasState(): CanvasState {
  return {
    parallel: false,
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

/** The zoom bar is hidden in Batch mode and while the panes show only text. */
export function isZoomBarShown(s: CanvasState): boolean {
  if (s.batch) return false;
  const { left, right } = s.sides;
  if (!s.parallel) return !left.text;
  return !!(left.image || right.image) || !(left.text || right.text);
}

/**
 * Canvas size for the current mode: the selected image, or the bounding box of everything shown.
 * Parallel mode: both panes' images (actual pixel ratio, each centred in the box).
 */
export function contentSize(s: CanvasState): { w: number; h: number } {
  const docW = s.docImage?.width ?? 0;
  const docH = s.docImage?.height ?? 0;
  const boundingBox = (images: (HTMLCanvasElement | null)[], initial: { w: number; h: number }) =>
    images.reduce(
      (size, img) => (img ? { w: Math.max(size.w, img.width), h: Math.max(size.h, img.height) } : size),
      initial,
    );
  if (s.batch) return { w: s.baseW, h: s.baseH };
  if (s.parallel) return boundingBox([s.sides.left.image, s.sides.right.image], { w: 0, h: 0 });
  if (!s.overlay) {
    const image = s.sides.left.image;
    return image ? { w: image.width, h: image.height } : { w: docW, h: docH };
  }
  return boundingBox([s.sides.left.image, s.sides.right.image, s.sides.left.underdrawing, s.sides.right.underdrawing], {
    w: docW,
    h: docH,
  });
}

const summaryMessage = (summary: SelectionSummary, mode: 'normal' | 'parallel') =>
  summary.kind === 'folder'
    ? `フォルダ「${summary.name ?? ''}」を選択中です。表示する画像を選択してください`
    : `${summary.count} 件を選択中です。${mode === 'normal' ? 'Normal モードでは' : '各ペインには'} 1 件ずつ表示します`;

/**
 * Message shown over the canvas area when nothing is displayed (docs/specs/canvas.md 「表示ルール」),
 * or null when something is shown. Parallel mode words it per pane instead (emptyPaneMessage).
 */
export function emptyCanvasMessage(s: CanvasState): string | null {
  const { left } = s.sides;
  if (s.parallel) return null;
  if (s.batch) {
    return s.batchImages.some(i => i.canvas) ? null : 'ARCHIVES から画像またはフォルダを選択してください';
  }
  if (s.overlay) {
    return left.image || left.underdrawing || s.docImage
      ? null
      : 'ARCHIVES から重ね合わせる画像（U: 下絵 / T: 上絵）を選択してください';
  }
  if (left.image || left.text) return null;
  return left.summary ? summaryMessage(left.summary, 'normal') : 'ARCHIVES から画像を選択してください';
}

/** Parallel mode: message in a pane that shows nothing (its own ARCHIVES selection only), or null. */
export function emptyPaneMessage(s: CanvasState, side: Side): string | null {
  const me = s.sides[side];
  if (!s.parallel || me.image || me.text) return null;
  if (me.summary) return summaryMessage(me.summary, 'parallel');
  return `${side === 'left' ? '左' : '右'}の ARCHIVES から画像を選択してください`;
}

/** Slider view: clip-path of the front pane, which keeps the part before the divider at `pct` percent. */
export function sliderClip(pct: number, vertical: boolean): string {
  const rest = `${100 - pct}%`;
  return vertical ? `inset(0 0 ${rest} 0)` : `inset(0 ${rest} 0 0)`;
}
