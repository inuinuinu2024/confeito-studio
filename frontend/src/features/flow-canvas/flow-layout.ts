/**
 * Automatic left-to-right layout of the visible flow (docs/specs/flow-canvas.md 「配置」). Pure functions.
 *
 * The canvas is made of rows (one per panel, page or result without input; a label column on the left). In a
 * row the steps follow each other from left to right, each next step right after the one it comes from with its
 * images level with that image; branches go one below the other in the same row. Rows never overlap, so nothing
 * has to be saved or moved by hand.
 */
import type { FlowStep, FlowTree, VisibleFlow } from './flow-graph';

export const LAYOUT = {
  cellWidth: 216,
  /** Left column of the row labels (コマ #1 …). */
  gutter: 132,
  columnGap: 72,
  rowGap: 24,
  treeGap: 40,
  /** Step header and the padding around its cells. */
  headerHeight: 34,
  padding: 8,
  cellHeight: 196,
  cellGap: 8,
  /** Margin around the whole flow. */
  margin: 24,
} as const;

/** The 「コマ分割」 button next to a page that is not split yet. */
export const ACTION_SIZE = { w: 132, h: 40 } as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One row of the canvas: a panel (or page / result without input) and everything made from it. */
export interface FlowRow {
  /** Id of the step that starts the row. */
  id: string;
  y: number;
  h: number;
}

export interface FlowLayout {
  rows: FlowRow[];
  steps: Map<string, Rect>;
  cells: Map<string, Rect>;
  width: number;
  height: number;
}

/** Height of a step with `rows` cells one below the other. */
export function stepHeight(rows: number): number {
  const { headerHeight, padding, cellHeight, cellGap } = LAYOUT;
  return headerHeight + padding * 2 + rows * cellHeight + Math.max(0, rows - 1) * cellGap;
}

/** Width of a step with `columns` cells side by side. */
export function stepWidth(columns: number): number {
  const { padding, cellWidth, cellGap } = LAYOUT;
  return padding * 2 + columns * cellWidth + Math.max(0, columns - 1) * cellGap;
}

export function layoutFlow(flow: VisibleFlow): FlowLayout {
  const { columnGap, rowGap, treeGap, headerHeight, padding, cellHeight, cellWidth, cellGap, margin, gutter } = LAYOUT;
  const steps = new Map<string, Rect>();
  const cells = new Map<string, Rect>();
  const rows: FlowRow[] = [];
  let width = 0;

  /** Places `step` with its top left at (`x`, `y`); returns the bottom and the right end of everything after it. */
  const place = (step: FlowStep, x: number, y: number): { bottom: number; right: number } => {
    const across = step.layout !== 'column';
    const action = step.layout === 'action';
    const w = action ? ACTION_SIZE.w : stepWidth(across ? step.cells.length : 1);
    const h = action ? ACTION_SIZE.h : stepHeight(across ? 1 : step.cells.length);
    // A button is level with the middle of the image it comes from.
    const top = action ? y + headerHeight + padding + (cellHeight - h) / 2 : y;
    steps.set(step.id, { x, y: top, w, h });
    width = Math.max(width, x + w + margin);
    step.cells.forEach((cell, i) => {
      cells.set(cell.key, {
        x: x + padding + (across ? i * (cellWidth + cellGap) : 0),
        y: y + headerHeight + padding + (across ? 0 : i * (cellHeight + cellGap)),
        w: cellWidth,
        h: cellHeight,
      });
    });
    let bottom = top + h;
    let right = x + w;
    let cursor = y;
    const nextX = x + w + columnGap;
    step.cells.forEach((_cell, i) => {
      // The next steps follow right after this step, their images level with this image.
      const cellTop = y + (across ? 0 : i * (cellHeight + cellGap));
      let childY = Math.max(cellTop, cursor);
      for (const child of step.cellChildren[i]) {
        const result = place(child, nextX, childY);
        right = Math.max(right, result.right);
        bottom = Math.max(bottom, result.bottom);
        childY = result.bottom + rowGap;
        cursor = childY;
      }
    });
    const after = placeBelow(step.runChildren, right + columnGap, y);
    return { bottom: Math.max(bottom, after.bottom), right: Math.max(right, after.right) };
  };

  /** Steps one below the other from (`x`, `y`) (nothing to place: bottom 0). */
  const placeBelow = (list: FlowStep[], x: number, y: number) => {
    let bottom = 0;
    let right = 0;
    let nextY = y;
    for (const step of list) {
      const result = place(step, x, nextY);
      right = Math.max(right, result.right);
      bottom = Math.max(bottom, result.bottom);
      nextY = result.bottom + rowGap;
    }
    return { bottom, right };
  };

  /** A tree: one row per first step (the label column on the left), `after` right of all of them. */
  const placeTree = (tree: FlowTree, y: number): number => {
    let bottom = y;
    let right = 0;
    let nextY = y;
    for (const step of tree.steps) {
      const result = place(step, margin + gutter, nextY);
      rows.push({ id: step.id, y: nextY, h: result.bottom - nextY });
      right = Math.max(right, result.right);
      bottom = Math.max(bottom, result.bottom);
      nextY = result.bottom + rowGap;
    }
    return Math.max(bottom, placeBelow(tree.after, right + columnGap, y).bottom);
  };

  let y = margin;
  for (const tree of flow.trees) y = placeTree(tree, y) + treeGap;
  const height = flow.trees.length ? y - treeGap + margin : 0;
  return { rows, steps, cells, width: flow.trees.length ? width : 0, height };
}

/**
 * SVG path of an edge from the right middle of `from` to the left of `to` at `toY`: horizontal, then
 * vertical in the gap before `to` (edges into one step share that line), then horizontal, with
 * rounded corners.
 */
export function edgePath(from: Rect, to: Rect, toY: number): string {
  const x1 = from.x + from.w;
  const y1 = from.y + from.h / 2;
  const x2 = to.x;
  const mx = Math.max(x1 + 8, x2 - LAYOUT.columnGap / 2);
  const dy = toY - y1;
  if (Math.abs(dy) < 1) return `M ${x1} ${y1} H ${x2}`;
  const r = Math.min(8, Math.abs(dy) / 2, (mx - x1) / 2, (x2 - mx) / 2);
  const sy = Math.sign(dy);
  return [
    `M ${x1} ${y1}`,
    `H ${mx - r}`,
    `Q ${mx} ${y1} ${mx} ${y1 + sy * r}`,
    `V ${toY - sy * r}`,
    `Q ${mx} ${toY} ${mx + r} ${toY}`,
    `H ${x2}`,
  ].join(' ');
}

/** The rectangle covering `rects`, or null for none. */
export function boundsOf(rects: Iterable<Rect>): Rect | null {
  let box: { x1: number; y1: number; x2: number; y2: number } | null = null;
  for (const r of rects) {
    box = box
      ? {
          x1: Math.min(box.x1, r.x),
          y1: Math.min(box.y1, r.y),
          x2: Math.max(box.x2, r.x + r.w),
          y2: Math.max(box.y2, r.y + r.h),
        }
      : { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h };
  }
  return box && { x: box.x1, y: box.y1, w: box.x2 - box.x1, h: box.y2 - box.y1 };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
