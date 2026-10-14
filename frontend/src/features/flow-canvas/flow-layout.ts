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
  /** Left column of the row labels (コマ 1 …). */
  gutter: 132,
  columnGap: 72,
  rowGap: 24,
  treeGap: 40,
  /** Step header and the padding around its cells. */
  headerHeight: 34,
  padding: 8,
  cellHeight: 196,
  cellGap: 8,
  /** Between the 原画 and the images generated from it (a box of layout `row`): room for the ▶ between them. */
  originGap: 36,
  /**
   * The panel rows' tool buttons (AI画像生成, 背景除去), right after everything in each row, and the room before them;
   * the 全コマ header row above the first panel row holds the same buttons for every panel.
   */
  toolsWidth: 168,
  toolsGap: 16,
  /** The 全コマ header row: its two buttons, then the room before the line above the first panel row. */
  panelHeader: 52 + 24,
  /** Margin around the whole flow (above it: `topMargin`, close to the toolbar). */
  margin: 24,
  topMargin: 12,
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

/**
 * The tool buttons of the panel rows (docs/specs/flow-canvas.md 「コマの行のツール」「全コマのツール」): at the left of the
 * free room of each row (right after everything in it), level with its images; and in the 全コマ header above the first
 * row, at the left of its free room (where the images of the rows start).
 */
export interface PanelTools {
  /** The 全コマ header row: from the top of the panel rows' block, before the line above the first row. */
  header: { x: number; y: number; h: number };
  /** Each panel row (its step id): the left of its buttons and the top of its images. */
  rows: { id: string; x: number; y: number }[];
}

export interface FlowLayout {
  rows: FlowRow[];
  steps: Map<string, Rect>;
  cells: Map<string, Rect>;
  /** Null without panel rows. */
  panelTools: PanelTools | null;
  width: number;
  height: number;
}

/**
 * Height of a step with `rows` cells one below the other. The step that starts a row has no heading of its own (it is the
 * row label at the left), so its images start right below the row's line (`head` false).
 */
export function stepHeight(rows: number, head = true): number {
  const { headerHeight, padding, cellHeight, cellGap } = LAYOUT;
  return (head ? headerHeight : 0) + padding * 2 + rows * cellHeight + Math.max(0, rows - 1) * cellGap;
}

/** Left of cell `index` in a step with its cells side by side (from the step's padding). */
export function cellLeft(index: number, origin = false): number {
  const { cellWidth, cellGap, originGap } = LAYOUT;
  return index * (cellWidth + cellGap) + (origin && index > 0 ? originGap - cellGap : 0);
}

/** Width of a step with `columns` cells side by side (`origin`: a 原画 with images generated from it). */
export function stepWidth(columns: number, origin = false): number {
  const { padding, cellWidth } = LAYOUT;
  return padding * 2 + (columns ? cellLeft(columns - 1, origin) + cellWidth : 0);
}

export function layoutFlow(flow: VisibleFlow): FlowLayout {
  const { columnGap, rowGap, treeGap, headerHeight, padding, cellHeight, cellWidth, cellGap, margin, gutter } = LAYOUT;
  const steps = new Map<string, Rect>();
  const cells = new Map<string, Rect>();
  const rows: FlowRow[] = [];
  let width = 0;

  /** Places `step` with its top left at (`x`, `y`); returns the bottom and the right end of everything after it. */
  const place = (
    step: FlowStep,
    x: number,
    y: number,
    imageTop: number = headerHeight + padding,
  ): { bottom: number; right: number } => {
    const across = step.layout !== 'column';
    const action = step.layout === 'action';
    const origin = step.layout === 'row';
    const w = action ? ACTION_SIZE.w : stepWidth(across ? step.cells.length : 1, origin);
    const head = step.rowHead ? 0 : headerHeight;
    const h = action ? ACTION_SIZE.h : stepHeight(across ? 1 : step.cells.length, !step.rowHead);
    // A button is level with the middle of the image it comes from (`imageTop`: where that image is from `y`).
    const top = action ? y + imageTop + (cellHeight - h) / 2 : y;
    steps.set(step.id, { x, y: top, w, h });
    width = Math.max(width, x + w + margin);
    step.cells.forEach((cell, i) => {
      cells.set(cell.key, {
        x: x + padding + (across ? cellLeft(i, origin) : 0),
        y: y + head + padding + (across ? 0 : i * (cellHeight + cellGap)),
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
        const result = place(child, nextX, childY, head + padding);
        right = Math.max(right, result.right);
        bottom = Math.max(bottom, result.bottom);
        childY = result.bottom + rowGap;
        cursor = childY;
      }
    });
    const after = placeBelow(step.runChildren, right + columnGap, y, head + padding);
    return { bottom: Math.max(bottom, after.bottom), right: Math.max(right, after.right) };
  };

  /** Steps one below the other from (`x`, `y`) (nothing to place: bottom 0). */
  const placeBelow = (list: FlowStep[], x: number, y: number, imageTop?: number) => {
    let bottom = 0;
    let right = 0;
    let nextY = y;
    for (const step of list) {
      const result = place(step, x, nextY, imageTop);
      right = Math.max(right, result.right);
      bottom = Math.max(bottom, result.bottom);
      nextY = result.bottom + rowGap;
    }
    return { bottom, right };
  };

  /** A tree: one row per first step (the label column on the left), `after` right of all of them. */
  const placeTree = (tree: FlowTree, y: number): number => {
    // The panel rows of a split page: the 全コマ header above them, their tools in one column right of them.
    const panels = !!tree.steps[0]?.panelIndex;
    const top = panels ? y + LAYOUT.panelHeader : y;
    let bottom = top;
    let right = 0;
    let nextY = top;
    const placed: { id: string; x: number; y: number }[] = [];
    for (const step of tree.steps) {
      const result = place(step, margin + gutter, nextY);
      rows.push({ id: step.id, y: nextY, h: result.bottom - nextY });
      placed.push({ id: step.id, x: result.right + LAYOUT.toolsGap, y: nextY + padding });
      right = Math.max(right, result.right);
      bottom = Math.max(bottom, result.bottom);
      nextY = result.bottom + rowGap;
    }
    if (panels) {
      panelTools = { header: { x: margin + gutter + padding, y, h: LAYOUT.panelHeader - rowGap }, rows: placed };
      for (const row of placed) width = Math.max(width, row.x + LAYOUT.toolsWidth + margin);
    }
    return Math.max(bottom, placeBelow(tree.after, right + columnGap, top).bottom);
  };

  let panelTools: PanelTools | null = null;
  let y = LAYOUT.topMargin;
  for (const tree of flow.trees) y = placeTree(tree, y) + treeGap;
  const height = flow.trees.length ? y - treeGap + margin : 0;
  return { rows, steps, cells, panelTools, width: flow.trees.length ? width : 0, height };
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

/** A ＋ on the line between two panel rows, above the first or below the last (docs/specs/flow-canvas.md 「コマの追加」). */
export interface PanelGap {
  /** The panel rows it is between (null: at the top / the bottom). */
  after: FlowStep | null;
  before: FlowStep | null;
  /** Its centre: over the 原画 column, on the line between the rows. */
  x: number;
  y: number;
}

/** The ＋ of the panel rows of a split page, top to bottom ([] without panel rows). */
export function panelGaps(flow: VisibleFlow, layout: FlowLayout): PanelGap[] {
  const { margin, gutter, padding, cellWidth, rowGap } = LAYOUT;
  const rows = layout.rows.flatMap(row => {
    const step = flow.steps.get(row.id);
    return step?.panelIndex ? [{ row, step }] : [];
  });
  const last = rows[rows.length - 1];
  if (!last) return [];
  const x = margin + gutter + padding + cellWidth / 2;
  return [
    ...rows.map(({ row, step }, i) => ({ after: rows[i - 1]?.step ?? null, before: step, x, y: row.y - rowGap / 2 })),
    { after: last.step, before: null, x, y: last.row.y + last.row.h + rowGap / 2 },
  ];
}
