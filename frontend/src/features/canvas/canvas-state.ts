/**
 * Mutable state of the comparison canvas (Parallel / Overlay in the comparison window, compare-window.ts). Owned by
 * comparison-view.ts and passed to the pure-ish renderer (render.ts) and the zoom controller (zoom.ts).
 *
 * "left"/"right" are the two panes: the right one is shown in Parallel only. The images compared are the first
 * image of a flow and an image generated from it (L / R, U / T).
 */

export type Side = 'left' | 'right';

/** An image compared: Overlay's underdrawing (U) and top image (T), Parallel's left (L) and right (R) pane. */
export type ViewLayer = 'under' | 'top' | 'left' | 'right';

export interface CanvasState {
  /** Mirrors of the view mode, updated in the order the toggle events arrive. */
  parallel: boolean;
  overlay: boolean;
  /** Slider: the two Parallel panes stacked (wipe view); its options: vertical split, swapped sides. */
  slider: boolean;
  vertical: boolean;
  flipped: boolean;
  splitPct: number;

  /** Size the canvases were created with. */
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
   * The images compared: Overlay mode's underdrawing (U) and top image (T), Parallel mode's left (L) and
   * right (R) pane.
   */
  layers: Record<ViewLayer, HTMLCanvasElement | null>;
  /** Offset of T moved by the user, in canvas pixels (U and T are otherwise centred). */
  topOffset: { x: number; y: number };
  /** T is selected (double click) and can be moved with drag / arrow keys. */
  topSelected: boolean;
}

export function createCanvasState(): CanvasState {
  return {
    parallel: false,
    overlay: false,
    slider: false,
    vertical: false,
    flipped: false,
    splitPct: 50,
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
  };
}

/** Parallel or Overlay mode (the comparison canvas is shown). */
export const isComparing = (s: CanvasState): boolean => s.parallel || s.overlay;

/**
 * Canvas size: the bounding box of everything shown.
 * Parallel mode: both panes' images (actual pixel ratio, each centred in the box).
 * Overlay mode: U and T (centred; the part of a moved T outside the box is not drawn).
 */
export function contentSize(s: CanvasState): { w: number; h: number } {
  const boundingBox = (images: (HTMLCanvasElement | null)[]) =>
    images.reduce((size, img) => (img ? { w: Math.max(size.w, img.width), h: Math.max(size.h, img.height) } : size), {
      w: 0,
      h: 0,
    });
  if (s.parallel) return boundingBox([s.layers.left, s.layers.right]);
  if (s.overlay) return boundingBox([s.layers.under, s.layers.top]);
  return { w: 0, h: 0 };
}

/** Messages shown where an image is missing: in the left / right pane (Parallel) and over the area (Overlay). */
export interface EmptyMessages {
  left: string;
  right: string;
  overlay: string;
}

/**
 * Message shown over the canvas area when nothing is displayed, or null when something is shown.
 * Parallel mode words it per pane instead (emptyPaneMessage).
 */
export function emptyCanvasMessage(s: CanvasState, messages: EmptyMessages): string | null {
  if (!s.overlay) return null;
  return s.layers.under || s.layers.top ? null : messages.overlay;
}

/** Parallel mode: message in a pane without an image, or null. */
export function emptyPaneMessage(s: CanvasState, side: Side, messages: EmptyMessages): string | null {
  if (!s.parallel || s.layers[side]) return null;
  return messages[side];
}

/** Slider view: clip-path of the front pane, which keeps the part before the divider at `pct` percent. */
export function sliderClip(pct: number, vertical: boolean): string {
  const rest = `${100 - pct}%`;
  return vertical ? `inset(0 0 ${rest} 0)` : `inset(0 ${rest} 0 0)`;
}
