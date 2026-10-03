/**
 * Draws one pane of the canvas area from CanvasState.
 *
 *   Normal    left pane: the selected archive image (or text overlay), centered.
 *   Parallel  each pane: its own layer (L / R) only, centered in the bounding box of both.
 *   Overlay   left pane only: U (underdrawing, optionally tinted) + T (top image, translucent, movable).
 *   Batch     2-column grid of the images under the selected folder.
 */
import type { BatchImage, CanvasState, Side } from './canvas-state';

export const TINT_COLORS: Record<string, string> = {
  blue: '#448aff',
  green: '#4caf50',
  red: '#ff5252',
  gray: '#9e9e9e',
};

/** Batch grid layout (canvas pixels). */
export const BATCH_GRID = { tileW: 800, tileH: 600, columns: 2, margin: 20, titleHeight: 40, padding: 20 };

export function batchGridSize(imageCount: number): { w: number; h: number } {
  const { tileW, tileH, columns, margin } = BATCH_GRID;
  const rows = Math.ceil(imageCount / columns);
  return { w: tileW * columns + margin * (columns + 1), h: tileH * rows + margin * (rows + 1) };
}

function checkerboard(ctx: CanvasRenderingContext2D): CanvasPattern | string {
  const tile = document.createElement('canvas');
  tile.width = 16;
  tile.height = 16;
  const t = tile.getContext('2d');
  if (!t) return '#FFFFFF';
  t.fillStyle = '#FFFFFF';
  t.fillRect(0, 0, 16, 16);
  t.fillStyle = '#D9D9D9';
  t.fillRect(0, 0, 8, 8);
  t.fillRect(8, 8, 8, 8);
  return ctx.createPattern(tile, 'repeat') || '#FFFFFF';
}

/** Last tinted copy of each source (redraws while T is dragged must not recompute it). */
const tintCache = new WeakMap<HTMLCanvasElement, { color: string; canvas: HTMLCanvasElement }>();

/** Grayscale copy of `source` screened with `color`, keeping the source alpha. */
export function tinted(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const cached = tintCache.get(source);
  if (cached?.color === color) return cached.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.filter = 'grayscale(100%)';
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(source, 0, 0);
  tintCache.set(source, { color, canvas });
  return canvas;
}

/** Rectangle of the Overlay mode top image (T) in canvas pixels, or null. */
export function topImageRect(s: CanvasState): { x: number; y: number; w: number; h: number } | null {
  const { topOffset } = s;
  const { top } = s.layers;
  if (!top) return null;
  return {
    x: topOffset.x + s.drawW / 2 - top.width / 2,
    y: topOffset.y + s.drawH / 2 - top.height / 2,
    w: top.width,
    h: top.height,
  };
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.body).getPropertyValue(name) || fallback;
}

function drawBatchGrid(ctx: CanvasRenderingContext2D, images: BatchImage[], originX: number, originY: number): void {
  const { tileW, tileH, columns, margin, titleHeight, padding } = BATCH_GRID;
  const pattern = checkerboard(ctx);
  let index = 0;
  for (const image of images) {
    if (!image.canvas) continue;
    const x = originX + margin + (index % columns) * (tileW + margin);
    const y = originY + margin + Math.floor(index / columns) * (tileH + margin);
    index++;

    ctx.fillStyle = cssVar('--color-surface-container-low', '#f5f5f5');
    ctx.fillRect(x, y, tileW, tileH);
    ctx.strokeStyle = cssVar('--color-outline-variant', '#555555');
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, tileW - 1, tileH - 1);

    ctx.fillStyle = cssVar('--color-on-surface', '#000000');
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(image.name.split('/').pop() || 'Image', x + padding, y + padding + titleHeight / 2 - 4);

    // Left half: the image; right half: placeholder for a future result.
    const halfW = (tileW - padding * 3) / 2;
    const halfH = tileH - titleHeight - padding * 2;
    const scale = Math.min(halfW / image.canvas.width, halfH / image.canvas.height);
    const w = image.canvas.width * scale;
    const h = image.canvas.height * scale;
    const imgX = x + padding + (halfW - w) / 2;
    const imgY = y + padding + titleHeight + (halfH - h) / 2;
    ctx.drawImage(image.canvas, imgX, imgY, w, h);

    const placeholderX = x + padding + halfW + padding + (halfW - w) / 2;
    ctx.fillStyle = pattern;
    ctx.fillRect(placeholderX, imgY, w, h);
    ctx.strokeStyle = cssVar('--color-outline-variant', '#888888');
    ctx.lineWidth = 1;
    ctx.strokeRect(placeholderX, imgY, w, h);
  }
}

/** U (optionally tinted) centred, T over it (translucent, centred + the user's offset). */
function drawOverlay(ctx: CanvasRenderingContext2D, s: CanvasState): void {
  const { under, top } = s.layers;
  if (under) {
    const color = s.tint ? TINT_COLORS[s.tint] : undefined;
    const source = color ? tinted(under, color) : under;
    ctx.drawImage(source, s.drawW / 2 - source.width / 2, s.drawH / 2 - source.height / 2);
  }

  const rect = topImageRect(s);
  if (rect && top) {
    ctx.globalAlpha = s.topOpacity / 100;
    ctx.drawImage(top, rect.x, rect.y);
    ctx.globalAlpha = 1;
    if (s.topSelected) {
      // One screen pixel in canvas pixels (the canvas element is scaled by the zoom).
      const unit = s.drawW / (ctx.canvas.clientWidth || s.drawW);
      ctx.strokeStyle = '#0078d4';
      ctx.lineWidth = 2 * unit;
      ctx.setLineDash([5 * unit, 5 * unit]);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.setLineDash([]);
    }
  }
}

function fillBackground(ctx: CanvasRenderingContext2D, s: CanvasState, x: number, y: number, w: number, h: number) {
  if (!s.bgColor || s.bgColor === 'transparent') return;
  ctx.fillStyle = s.bgColor === 'checkerboard' ? checkerboard(ctx) : s.bgColor;
  ctx.fillRect(x, y, w, h);
}

export function renderSide(ctx: CanvasRenderingContext2D, s: CanvasState, side: Side): void {
  ctx.clearRect(0, 0, s.drawW, s.drawH);
  const cx = s.drawW / 2;
  const cy = s.drawH / 2;
  const docX = cx - s.baseW / 2;
  const docY = cy - s.baseH / 2;

  if (s.batch) {
    drawBatchGrid(ctx, s.batchImages, docX, docY);
    return;
  }

  if (s.overlay) {
    if (side !== 'left') return; // the right pane is hidden
    // The canvas is the bounding box of U and T: the background fills all of it.
    if (s.layers.under || s.layers.top) fillBackground(ctx, s, 0, 0, s.drawW, s.drawH);
    drawOverlay(ctx, s);
    return;
  }

  // Parallel: this pane's layer only (never the other pane's); Normal: the ARCHIVES selection.
  const image = s.parallel ? s.layers[side] : side === 'left' ? s.selection.image : null;
  if (!image) return;
  const x = cx - image.width / 2;
  const y = cy - image.height / 2;
  fillBackground(ctx, s, x, y, image.width, image.height);
  ctx.drawImage(image, x, y);
}
