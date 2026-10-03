/**
 * Mutable state of the canvas area. Owned by Canvas.ts and passed to the pure-ish
 * renderer (render.ts) and the zoom controller (zoom.ts).
 *
 * "left"/"right" are the two panes: the left pane is the only one outside Parallel mode.
 * Normal mode shows the ARCHIVES selection; Parallel / Overlay mode show the layers chosen with the
 * ARCHIVES checkbox columns (L / R, U / T) and keep tracking the selection without showing it.
 */

import type { SelectionSummary, ViewLayer } from '../../shared/events';

export type Side = 'left' | 'right';

/** What the ARCHIVES panel has selected (shown in Normal mode). */
export interface SelectionState {
  image: HTMLCanvasElement | null;
  /** A text file (json/txt/md) is selected: shown in the text overlay instead of an image. */
  text: boolean;
  /** A folder or several entries are selected: nothing is shown, the empty message says so. */
  summary: SelectionSummary | null;
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
  /**
   * Images chosen with the ARCHIVES checkboxes: Overlay mode's underdrawing (U) and top image (T),
   * Parallel mode's left (L) and right (R) pane.
   */
  layers: Record<ViewLayer, HTMLCanvasElement | null>;
  /** Offset of T moved by the user, in canvas pixels (U and T are otherwise centred). */
  topOffset: { x: number; y: number };
  /** T is selected (double click) and can be moved with drag / arrow keys. */
  topSelected: boolean;

  selection: SelectionState;
  batchImages: BatchImage[];
}

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
    layers: { under: null, top: null, left: null, right: null },
    topOffset: { x: 0, y: 0 },
    topSelected: false,
    selection: { image: null, text: false, summary: null },
    batchImages: [],
  };
}

/** Parallel or Overlay mode: the layers are shown instead of the ARCHIVES selection. */
export const isComparing = (s: CanvasState): boolean => s.parallel || s.overlay;

/** The zoom bar is hidden in Batch mode and while a text file is shown (Normal mode only). */
export function isZoomBarShown(s: CanvasState): boolean {
  if (s.batch) return false;
  return isComparing(s) || !s.selection.text;
}

/**
 * Canvas size for the current mode: the selected image, or the bounding box of everything shown.
 * Parallel mode: both panes' images (actual pixel ratio, each centred in the box).
 * Overlay mode: U and T (centred; the part of a moved T outside the box is not drawn).
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
  if (s.parallel) return boundingBox([s.layers.left, s.layers.right], { w: 0, h: 0 });
  if (s.overlay) return boundingBox([s.layers.under, s.layers.top], { w: 0, h: 0 });
  const image = s.selection.image;
  return image ? { w: image.width, h: image.height } : { w: docW, h: docH };
}

const summaryMessage = (summary: SelectionSummary) =>
  summary.kind === 'folder'
    ? `フォルダ「${summary.name ?? ''}」を選択中です。表示する画像を選択してください`
    : `${summary.count} 件を選択中です。Normal モードでは 1 件ずつ表示します`;

/**
 * Message shown over the canvas area when nothing is displayed (docs/specs/canvas.md 「表示ルール」),
 * or null when something is shown. Parallel mode words it per pane instead (emptyPaneMessage).
 */
export function emptyCanvasMessage(s: CanvasState): string | null {
  const { selection } = s;
  if (s.parallel) return null;
  if (s.batch) {
    return s.batchImages.some(i => i.canvas) ? null : 'ARCHIVES から画像またはフォルダを選択してください';
  }
  if (s.overlay) {
    return s.layers.under || s.layers.top
      ? null
      : 'ARCHIVES の U / T 列で重ね合わせる画像（U: 下絵 / T: 上絵）を選択してください';
  }
  if (selection.image || selection.text) return null;
  return selection.summary ? summaryMessage(selection.summary) : 'ARCHIVES から画像を選択してください';
}

/** Parallel mode: message in a pane without an image (L / R not chosen), or null. */
export function emptyPaneMessage(s: CanvasState, side: Side): string | null {
  if (!s.parallel || s.layers[side]) return null;
  return side === 'left'
    ? 'ARCHIVES の L 列で左に表示する画像を選択してください'
    : 'ARCHIVES の R 列で右に表示する画像を選択してください';
}

/** Slider view: clip-path of the front pane, which keeps the part before the divider at `pct` percent. */
export function sliderClip(pct: number, vertical: boolean): string {
  const rest = `${100 - pct}%`;
  return vertical ? `inset(0 0 ${rest} 0)` : `inset(0 ${rest} 0 0)`;
}
