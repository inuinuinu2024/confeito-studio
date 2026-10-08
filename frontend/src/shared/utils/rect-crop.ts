/**
 * A free rectangular crop frame in the pixels of the source image (pure, unit tested): the frame of a panel
 * on its page when it is cut again (docs/specs/flow-canvas.md 「コマの切り直し」). The frame always stays inside
 * the image and is never smaller than MIN_RECT (or the image).
 */

export const MIN_RECT = 8;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A corner or an edge of the frame. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** `[xmin, ymin, xmax, ymax]` (panels.json `pixel_box`). */
export type Box = [number, number, number, number];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const rectOfBox = ([xmin, ymin, xmax, ymax]: Box): Rect => ({
  x: xmin,
  y: ymin,
  w: xmax - xmin,
  h: ymax - ymin,
});

/** The box of `rect` in whole pixels, inside a `width` x `height` image. */
export function boxOfRect(rect: Rect, width: number, height: number): Box {
  const xmin = clamp(Math.round(rect.x), 0, Math.max(0, width - 1));
  const ymin = clamp(Math.round(rect.y), 0, Math.max(0, height - 1));
  const xmax = clamp(Math.round(rect.x + rect.w), xmin + 1, width);
  const ymax = clamp(Math.round(rect.y + rect.h), ymin + 1, height);
  return [xmin, ymin, xmax, ymax];
}

export const sameBox = (a: Box, b: Box) => a.every((v, i) => v === b[i]);

/** The frame moved by (dx, dy), kept inside the image. */
export function moveRect(rect: Rect, dx: number, dy: number, width: number, height: number): Rect {
  return { ...rect, x: clamp(rect.x + dx, 0, width - rect.w), y: clamp(rect.y + dy, 0, height - rect.h) };
}

/**
 * The frame resized by dragging `handle` to (px, py): the opposite edges stay, the dragged edges follow the
 * pointer but stay inside the image and keep at least MIN_RECT from the opposite edge.
 */
export function resizeRect(rect: Rect, handle: Handle, px: number, py: number, width: number, height: number): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.w;
  let bottom = rect.y + rect.h;
  const minW = Math.min(MIN_RECT, width);
  const minH = Math.min(MIN_RECT, height);
  if (handle.includes('w')) left = clamp(px, 0, right - minW);
  if (handle.includes('e')) right = clamp(px, left + minW, width);
  if (handle.includes('n')) top = clamp(py, 0, bottom - minH);
  if (handle.includes('s')) bottom = clamp(py, top + minH, height);
  return { x: left, y: top, w: right - left, h: bottom - top };
}
