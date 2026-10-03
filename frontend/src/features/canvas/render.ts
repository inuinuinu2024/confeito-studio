/**
 * Draws one pane of the canvas area from CanvasState.
 *
 *   Normal    left pane: the selected archive image (or text overlay), centered.
 *   Parallel  each pane: its own side's image only, centered in the bounding box of both.
 *   Overlay  U (underdrawing, optionally tinted) + T (selected image, translucent, movable).
 *   Batch    2-column grid of the images under the selected folder.
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

/** Grayscale copy of `source` screened with `color`, keeping the source alpha. */
export function tinted(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
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
  return canvas;
}

/** Rectangle of this side's top image (T) in canvas pixels, or null. */
export function topImageRect(s: CanvasState, side: Side): { x: number; y: number; w: number; h: number } | null {
  const { image, topOffset } = s.sides[side];
  if (!image) return null;
  return {
    x: topOffset.x + s.drawW / 2 - image.width / 2,
    y: topOffset.y + s.drawH / 2 - image.height / 2,
    w: image.width,
    h: image.height,
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

function drawOverlay(ctx: CanvasRenderingContext2D, s: CanvasState, side: Side): void {
  const me = s.sides[side];
  const cx = s.drawW / 2;
  const cy = s.drawH / 2;

  // U: explicit underdrawing, else (when there is no T) the left image / document.
  const under = me.underdrawing || (!me.image ? s.sides.left.image || s.docImage : null);
  if (under) {
    const color = s.tint ? TINT_COLORS[s.tint] : undefined;
    const source = color ? tinted(under, color) : under;
    ctx.drawImage(source, cx - source.width / 2, cy - source.height / 2);
  }

  const top = topImageRect(s, side);
  if (top && me.image) {
    ctx.globalAlpha = s.topOpacity / 100;
    ctx.drawImage(me.image, top.x, top.y);
    ctx.globalAlpha = 1;
    if (me.topSelected) {
      const unit = 1 / (s.zoom / 100);
      ctx.strokeStyle = '#0078d4';
      ctx.lineWidth = 2 * unit;
      ctx.setLineDash([5 * unit, 5 * unit]);
      ctx.strokeRect(top.x, top.y, top.w, top.h);
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
  const me = s.sides[side];

  if (s.batch) {
    drawBatchGrid(ctx, s.batchImages, docX, docY);
    return;
  }

  if (s.overlay) {
    if (me.underdrawing || me.image || s.sides.left.image || s.docImage)
      fillBackground(ctx, s, docX, docY, s.baseW, s.baseH);
    drawOverlay(ctx, s, side);
    return;
  }

  // Normal / Parallel: only this pane's own selection (never the document image or the other pane's).
  const image = me.image;
  if (!image) return;
  const x = cx - image.width / 2;
  const y = cy - image.height / 2;
  fillBackground(ctx, s, x, y, image.width, image.height);
  ctx.drawImage(image, x, y);
}
