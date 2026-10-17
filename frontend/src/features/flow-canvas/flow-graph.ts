/**
 * The processing flow of one archive as a graph (docs/specs/flow-canvas.md). Pure functions only.
 *
 *   image ──(tool run)──▶ outputs ──(tool run)──▶ ...
 *
 * - A *stack* groups the runs of the same tool on the same input (re-runs); the canvas shows one run of
 *   each stack (the one the user picked, else the newest) and only that run's downstream flow.
 * - A run's input is its `source` image. コマ結合 takes a whole コマ分割 run (`source` = its folder) and
 *   lists the images it pasted in `sources`.
 * - Runs whose input is not in the archive (none, or deleted) start their own tree at the left edge.
 * - A panel cut again from the page (コマ切り直し, `source` = the panel) is a *version* of the panel: the panel's
 *   row shows one version (the one picked, else the newest) and only what was made from it.
 * - A panel added by hand (コマ追加, `source` = the コマ分割 folder) is one more panel of that split, in its own row
 *   between the panels it was added between (`panelOrder`).
 * - A panel of a コマ分割 deleted one by one is only marked (`removed`, in the archive's .flow.json): no row, not merged.
 */
import { RENAMED_TOOLS } from '../../shared/config';
import type { FlowData, FlowImage, FlowRun } from '../../shared/types/flow';

export interface FlowStack {
  id: string;
  /** Input image key, the input run folder (コマ結合), or null. */
  input: string | null;
  tool: string;
  /** Oldest first. */
  runs: FlowRun[];
}

export interface FlowGraph {
  archive: string;
  roots: FlowImage[];
  images: Map<string, FlowImage>;
  runs: Map<string, FlowRun>;
  stacks: Map<string, FlowStack>;
  stackOfRun: Map<string, string>;
  /** The run that produced each output image. */
  runOfImage: Map<string, FlowRun>;
  /** Stacks fed by an image key or a run folder, oldest first. */
  children: Map<string, string[]>;
  /** Stacks whose input is not in the archive. */
  orphans: string[];
  /** Shown run of the stacks the user switched (stack id -> folder). */
  selection: Record<string, string>;
  /** Image marked for コマ結合 per panel (panel image key -> image key). */
  merge: Record<string, string>;
  /** Panels of a コマ分割 deleted one by one (their image keys). */
  removed: Set<string>;
}

/** Runs with the same input and tool are stacked; a run without input is a stack of its own. */
export function stackIdOf(run: Pick<FlowRun, 'source' | 'tool' | 'folder'>): string {
  return run.source ? `${run.source}|${run.tool}` : `|${run.tool}|${run.folder}`;
}

/** `data` with the runs of renamed tools under their new name, and the stack ids of .flow.json to match. */
function renamedTools(data: FlowData): FlowData {
  const rename = (tool: string) => RENAMED_TOOLS[tool] ?? tool;
  // Stack ids are "<input>|<tool>" or "|<tool>|<folder>": the tool is a segment of its own.
  const renameStack = (id: string) => id.split('|').map(rename).join('|');
  const selection: Record<string, string> = {};
  // A choice saved under the new stack id wins over one saved under the old id.
  for (const [id, folder] of Object.entries(data.selection))
    if (renameStack(id) !== id) selection[renameStack(id)] = folder;
  for (const [id, folder] of Object.entries(data.selection)) if (renameStack(id) === id) selection[id] = folder;
  return {
    ...data,
    runs: data.runs.map(r => (rename(r.tool) === r.tool ? r : { ...r, tool: rename(r.tool) })),
    selection,
  };
}

export function buildGraph(raw: FlowData): FlowGraph {
  const data = renamedTools(raw);
  const images = new Map<string, FlowImage>();
  const runs = new Map<string, FlowRun>();
  const runOfImage = new Map<string, FlowRun>();
  for (const root of data.roots) images.set(root.key, root);
  for (const run of data.runs) {
    runs.set(run.folder, run);
    for (const output of run.outputs) {
      images.set(output.key, output);
      runOfImage.set(output.key, run);
    }
  }

  const stacks = new Map<string, FlowStack>();
  const stackOfRun = new Map<string, string>();
  for (const run of data.runs) {
    const id = stackIdOf(run);
    let stack = stacks.get(id);
    if (!stack) {
      stack = { id, input: run.source, tool: run.tool, runs: [] };
      stacks.set(id, stack);
    }
    stack.runs.push(run);
    stackOfRun.set(run.folder, id);
  }

  const children = new Map<string, string[]>();
  const orphans: string[] = [];
  for (const stack of stacks.values()) {
    const input = stack.input;
    // A run's own outputs can never be its input (that would be a cycle).
    const valid = input !== null && (images.has(input) || runs.has(input)) && !stackOutputs(stack).has(input);
    if (valid) children.set(input, [...(children.get(input) ?? []), stack.id]);
    else orphans.push(stack.id);
  }

  return {
    archive: data.archive,
    roots: data.roots,
    images,
    runs,
    stacks,
    stackOfRun,
    runOfImage,
    children,
    orphans,
    selection: data.selection,
    merge: data.merge ?? {},
    removed: new Set(Object.keys(data.removed ?? {})),
  };
}

function stackOutputs(stack: FlowStack): Set<string> {
  return new Set(stack.runs.flatMap(r => [r.folder, ...r.outputs.map(o => o.key)]));
}

/** The run a stack shows: the one picked by the user if it still exists, else the newest. */
export function shownRun(graph: FlowGraph, stack: FlowStack): FlowRun {
  const picked = graph.selection[stack.id];
  return stack.runs.find(r => r.folder === picked) ?? stack.runs[stack.runs.length - 1];
}

/** Tool name of コマ分割: a page split into panels is shown as its panels (docs/specs/flow-canvas.md). */
export const SPLIT_TOOL = 'コマ分割';
/** Tool name of コマ結合: its results are shown in the right pane, not in the flow. */
export const MERGE_TOOL = 'コマ結合';
/** Tool name of コマ切り直し: a panel cut again from its page, shown in the panel's row instead of it. */
export const RECROP_TOOL = 'コマ切り直し';
/** Tool name of コマ追加: a panel added by hand to a コマ分割, shown as one more panel row. */
export const ADD_TOOL = 'コマ追加';
/** Runs whose output is a panel version: the panel as split, a panel added by hand, a re-cut of either. */
const PANEL_TOOLS = new Set([SPLIT_TOOL, ADD_TOOL, RECROP_TOOL]);

/**
 * One box on the canvas: an imported page (no stack), the shown run of a stack, or one panel of a split page.
 * - `column`: the cells (outputs of the shown run) one below the other.
 * - `candidates`: the runs of a stack whose runs all have one output, side by side (oldest first); `run` is
 *   the adopted one and only its cell feeds further steps.
 * - `row`: one image followed, to its right, by the images generated from it as 原画 (and from those, in turn).
 * - `action`: the 「コマ分割」 button next to a page that is not split yet (no cells; `splitPage` is the page).
 */
export interface FlowStep {
  /** The stack id, "root:<key>" for an imported page, "<stack id>#<n>" for panel n of a split page. */
  id: string;
  stack: FlowStack | null;
  run: FlowRun | null;
  layout: 'column' | 'candidates' | 'row' | 'action';
  /** 1-based panel number when this box is one panel of a split page. */
  panelIndex?: number;
  /** The panel (output of the コマ分割) when this box is one panel of a split page; `cells[0]` is its shown version. */
  panel?: FlowImage;
  /** A panel row of a panel added by hand (コマ追加): `run` is that コマ追加 run. */
  added?: boolean;
  /** The first panel of the コマ分割 (not an added one): its heading switches between the runs of the split (‹ ›). */
  splitHead?: boolean;
  /** A panel row: the page that was split (shown in the left pane, not in the flow). */
  page?: string;
  /** `action`: key of the page the button splits. */
  splitPage?: string;
  /** Starts a row of the canvas (a panel, a page, a result without input): its title is the row label. */
  rowHead?: boolean;
  cells: FlowImage[];
  /** The run that made each cell (null for an imported page). */
  cellRuns: (FlowRun | null)[];
  /** Steps fed by each cell (same order as `cells`). */
  cellChildren: FlowStep[][];
  /** Steps fed by the run as a whole (コマ結合 of a コマ分割). */
  runChildren: FlowStep[];
}

/**
 * One block of the canvas: `steps` one below the other in the first column (a page, or the panels of a split
 * page), and `after` (コマ結合 of those panels) right of everything that follows them.
 */
export interface FlowTree {
  steps: FlowStep[];
  after: FlowStep[];
}

/** An edge from a shown image to a step it feeds. */
export interface FlowEdge {
  from: string;
  to: string;
}

export interface VisibleFlow {
  trees: FlowTree[];
  /**
   * The split page (or, with nothing split yet, the only page) and what was made from it one image at a time
   * (AI画像生成, 背景除去, … and from those), as one `row` box shown in the 元ページ pane, not in the flow (in `steps`,
   * not in `trees`). Null without a page.
   */
  pageRow: FlowStep | null;
  /**
   * The shown コマ結合 of the shown コマ分割 and what was made from its page one image at a time, as one `row` box
   * shown in the コマ結合後 pane (in `steps`, not in `trees`); its stack's runs (the merges) switch with ‹ ›. Null
   * without a merge.
   */
  mergeRow: FlowStep | null;
  edges: FlowEdge[];
  /** Step of each shown image. */
  stepOfCell: Map<string, FlowStep>;
  steps: Map<string, FlowStep>;
}

/** Several runs that each made one image: shown side by side, one of them adopted (★). */
const isCandidateStack = (stack: FlowStack) => stack.runs.length > 1 && stack.runs.every(r => r.outputs.length === 1);

/**
 * A run whose one image joins the row of its input image, next to it (docs/specs/flow-canvas.md 「処理の結果の表示」):
 * any tool, present or future (AI画像生成, 背景除去, …), that made one image from a known image. Not the panel tools
 * (コマ分割 / コマ切り直し / コマ追加): those are panels and their versions.
 */
export const joinsRow = (run: FlowRun) => run.source !== null && run.outputs.length === 1 && !PANEL_TOOLS.has(run.tool);

/** The stack of `run` when the canvas lets the user adopt one of its runs (★), else null. */
export function adoptableStack(graph: FlowGraph, run: FlowRun | null): FlowStack | null {
  const stack = run && graph.stacks.get(graph.stackOfRun.get(run.folder) ?? '');
  // The versions of a panel are picked in the panel cropper, not with ★; added panels are panels of their own; the
  // merges are switched with ‹ › in the コマ結合後 pane.
  const own = stack && [RECROP_TOOL, ADD_TOOL, MERGE_TOOL].includes(stack.tool);
  return stack && !own && isCandidateStack(stack) ? stack : null;
}

/** `[xmin, ymin, xmax, ymax]` in pixels of the page. */
export type PageBox = [number, number, number, number];

/** One version of a panel: the panel as split (or as added by hand), or a コマ切り直し of it. */
export interface PanelVersion {
  image: FlowImage;
  /** The コマ分割 run (the panel as split), the コマ追加 run (as added) or the コマ切り直し run. */
  run: FlowRun;
  /** "分割時" / "追加時" or "切り直し <n>" (n counts the re-cuts, oldest first). */
  label: string;
  /**
   * The box on the page (info.json settings.pixel_box of a re-cut or an added panel); null for the panel as split
   * (see panels.json).
   */
  box: PageBox | null;
}

const isBox = (value: unknown): value is PageBox =>
  Array.isArray(value) && value.length === 4 && value.every(v => typeof v === 'number' && Number.isFinite(v));

/**
 * The versions of `panel` (an output of a コマ分割 or a コマ追加), oldest first: the panel as split / added, then its
 * コマ切り直し runs.
 * `stackId` is the stack of the re-cuts (null when there is none); its selection picks the shown version
 * (the コマ分割 folder for the panel as split).
 */
export function panelVersions(
  graph: FlowGraph,
  panel: FlowImage,
): { versions: PanelVersion[]; stackId: string | null } {
  const split = graph.runOfImage.get(panel.key);
  if (!split) return { versions: [], stackId: null };
  const stackId = (graph.children.get(panel.key) ?? []).find(id => graph.stacks.get(id)?.tool === RECROP_TOOL) ?? null;
  const recuts = (stackId && graph.stacks.get(stackId)?.runs.filter(r => r.outputs.length)) || [];
  const added = split.tool === ADD_TOOL;
  return {
    versions: [
      {
        image: panel,
        run: split,
        label: added ? '追加時' : '分割時',
        box: added && isBox(split.settings.pixel_box) ? split.settings.pixel_box : null,
      },
      ...recuts.map((run, i) => ({
        image: run.outputs[0],
        run,
        label: `切り直し ${i + 1}`,
        box: isBox(run.settings.pixel_box) ? run.settings.pixel_box : null,
      })),
    ],
    stackId,
  };
}

/** The version of `panel` its row shows: the one picked (saved in the archive) if it still exists, else the newest. */
export function shownVersion(graph: FlowGraph, panel: FlowImage): PanelVersion | null {
  const { versions, stackId } = panelVersions(graph, panel);
  const picked = stackId ? graph.selection[stackId] : undefined;
  return versions.find(v => v.run.folder === picked) ?? versions[versions.length - 1] ?? null;
}

/** The panel version (a panel as split / added, or a コマ切り直し) that the image `key` is, or was made from; else null. */
export function versionOf(graph: FlowGraph, key: string): string | null {
  const seen = new Set<string>();
  let current = key;
  while (!seen.has(current)) {
    seen.add(current);
    const run = graph.runOfImage.get(current);
    if (!run) return null;
    if (PANEL_TOOLS.has(run.tool)) return current;
    if (!run.source || !graph.images.has(run.source)) return null;
    current = run.source;
  }
  return null;
}

/**
 * The first image of the flow `key` was made from (docs/specs/flow-canvas.md 「原画との比較」): its inputs followed
 * back to a panel version (a panel as split / added or a コマ切り直し), a start image, or a result whose input is unknown.
 * Null when `key` itself is such an image.
 */
export function flowOrigin(graph: FlowGraph, key: string): FlowImage | null {
  const seen = new Set<string>();
  let current = key;
  while (!seen.has(current)) {
    seen.add(current);
    const run = graph.runOfImage.get(current);
    if (!run || PANEL_TOOLS.has(run.tool)) break;
    if (!run.source || !graph.images.has(run.source)) break;
    current = run.source;
  }
  return current === key ? null : (graph.images.get(current) ?? null);
}

/** What the canvas shows: every tree with the shown run of each stack, and the edges between them. */
export function visibleFlow(graph: FlowGraph): VisibleFlow {
  const steps = new Map<string, FlowStep>();
  const stepOfCell = new Map<string, FlowStep>();
  /** Stacks shown inside the row of the image they were generated from. */
  const absorbed = new Set<string>();

  const childSteps = (key: string) =>
    (graph.children.get(key) ?? []).map(stackStep).filter((s): s is FlowStep => s !== null);
  const register = (step: FlowStep) => {
    steps.set(step.id, step);
    for (const cell of step.cells) stepOfCell.set(cell.key, step);
    return step;
  };
  const isAdopted = (run: FlowRun | null) => {
    const stack = run && graph.stacks.get(graph.stackOfRun.get(run.folder) ?? '');
    return !stack || shownRun(graph, stack) === run;
  };

  /**
   * A box of one image: the images generated from it as 原画 join it to the right (oldest first), and so do the
   * ones generated from an adopted one of those. Only adopted images feed further steps.
   */
  const fillRow = (step: FlowStep) => {
    for (let i = 0; i < step.cells.length; i++) {
      const run = step.cellRuns[i];
      if (i > 0 && !isAdopted(run)) {
        step.cellChildren[i] = [];
        continue;
      }
      const ids = graph.children.get(step.cells[i].key) ?? [];
      for (const id of ids) {
        const stack = graph.stacks.get(id);
        if (!stack || steps.has(id) || absorbed.has(id) || !stack.runs.every(joinsRow)) continue;
        absorbed.add(id);
        for (const r of stack.runs) {
          step.cells.push(r.outputs[0]);
          step.cellRuns.push(r);
          stepOfCell.set(r.outputs[0].key, step);
        }
      }
      step.cellChildren[i] = ids
        .filter(id => !absorbed.has(id))
        .map(stackStep)
        .filter((s): s is FlowStep => s !== null);
    }
    if (step.cells.length > 1) step.layout = 'row';
    return step;
  };

  function stackStep(id: string): FlowStep | null {
    const stack = graph.stacks.get(id);
    if (!stack || steps.has(id) || absorbed.has(id)) return null;
    const run = shownRun(graph, stack);
    if (isCandidateStack(stack)) {
      const step = register({
        id,
        stack,
        run,
        layout: 'candidates',
        cells: stack.runs.map(r => r.outputs[0]),
        cellRuns: stack.runs,
        cellChildren: [],
        runChildren: [],
      });
      step.cellChildren = stack.runs.map(r => (r === run ? childSteps(r.outputs[0].key) : []));
      step.runChildren = childSteps(run.folder);
      return step;
    }
    const step = register({
      id,
      stack,
      run,
      layout: 'column',
      cells: [...run.outputs],
      cellRuns: run.outputs.map(() => run),
      cellChildren: [],
      runChildren: [],
    });
    if (run.outputs.length === 1) fillRow(step);
    else step.cellChildren = run.outputs.map(cell => childSteps(cell.key));
    step.runChildren = childSteps(run.folder);
    return step;
  }

  let pageRow: FlowStep | null = null;
  let mergeRow: FlowStep | null = null;

  /** A box of `cells[0]` and what was made from it one image at a time (fillRow), always a row (its 原画 first). */
  const sideRow = (id: string, stack: FlowStack | null, run: FlowRun | null, image: FlowImage): FlowStep => {
    const row = fillRow(
      register({
        id,
        stack,
        run,
        layout: 'column',
        cells: [image],
        cellRuns: [run],
        cellChildren: [],
        runChildren: [],
      }),
    );
    row.layout = 'row';
    return row;
  };

  /**
   * A page with a コマ分割: its panels as boxes of their own; the page with the images made from it one at a time
   * as `pageRow` (the 元ページ pane), its other results (several images at once) as rows without input.
   */
  const splitPage = (root: FlowImage): FlowTree[] | null => {
    const childIds = graph.children.get(root.key) ?? [];
    const splitId = childIds.find(id => graph.stacks.get(id)?.tool === SPLIT_TOOL);
    const stack = splitId ? graph.stacks.get(splitId) : undefined;
    if (!splitId || !stack) return null;
    const run = shownRun(graph, stack);
    const panels = panelOrder(graph, run).map((cell, i) => {
      // The row shows one version of the panel; the re-cuts are not steps of their own.
      const { stackId: recutId } = panelVersions(graph, cell);
      if (recutId) absorbed.add(recutId);
      const version = shownVersion(graph, cell);
      // An added panel's row is its コマ追加 run (information, deletion); the others are the コマ分割's.
      const own = graph.runOfImage.get(cell.key);
      const added = own?.tool === ADD_TOOL;
      const ownStack = added ? graph.stacks.get(graph.stackOfRun.get(own.folder) ?? '') : undefined;
      return fillRow(
        register({
          id: `${splitId}#${i + 1}`,
          stack: ownStack ?? stack,
          run: added ? own : run,
          layout: 'column',
          panelIndex: i + 1,
          panel: cell,
          added,
          splitHead: cell === run.outputs[0],
          page: root.key,
          cells: [version?.image ?? cell],
          cellRuns: [version?.run ?? run],
          cellChildren: [],
          runChildren: [],
        }),
      );
    });
    // The page's row, like a page that is not split (fillRow), without the コマ分割 (the panel rows above).
    absorbed.add(splitId);
    pageRow = sideRow(`page:${root.key}`, null, null, root);
    const others = pageRow.cellChildren.flat();
    // コマ結合 of the panels: the shown one's row in the right pane, not in the flow.
    const mergeId = (graph.children.get(run.folder) ?? []).find(id => graph.stacks.get(id)?.tool === MERGE_TOOL);
    const mergeStack = mergeId ? graph.stacks.get(mergeId) : undefined;
    const merge = mergeStack && shownRun(graph, mergeStack);
    if (mergeId && mergeStack && merge?.outputs.length) {
      absorbed.add(mergeId);
      mergeRow = sideRow(`merge:${mergeId}`, mergeStack, merge, merge.outputs[0]);
      others.push(...mergeRow.cellChildren.flat());
    }
    return [{ steps: panels, after: [] }, ...others.map(step => ({ steps: [step], after: [] }))];
  };

  const trees: FlowTree[] = [];
  const actionEdges: FlowEdge[] = [];
  // Nothing split yet, one page: it is the page's row as well, shown like the 元ページ pane (no panel rows yet).
  // Several pages (not split) stay in the flow, each with its 「コマ分割」 button.
  const onePage = graph.roots.length === 1 && splitPageOf(graph) === null;
  for (const root of graph.roots) {
    const split = splitPage(root);
    if (split) {
      trees.push(...split);
      continue;
    }
    if (onePage) {
      pageRow = sideRow(`page:${root.key}`, null, null, root);
      trees.push(...pageRow.cellChildren.flat().map(step => ({ steps: [step], after: [] })));
      continue;
    }
    const step = register({
      id: `root:${root.key}`,
      stack: null,
      run: null,
      layout: 'column',
      cells: [root],
      cellRuns: [null],
      cellChildren: [],
      runChildren: [],
    });
    fillRow(step);
    // Not split yet: a 「コマ分割」 button right of the page, joined by an edge.
    const action = register({
      id: `split:${root.key}`,
      stack: null,
      run: null,
      layout: 'action',
      splitPage: root.key,
      cells: [],
      cellRuns: [],
      cellChildren: [],
      runChildren: [],
    });
    step.cellChildren[0] = [action, ...step.cellChildren[0]];
    actionEdges.push({ from: root.key, to: action.id });
    trees.push({ steps: [step], after: [] });
  }
  for (const id of graph.orphans) {
    const step = stackStep(id);
    if (step) trees.push({ steps: [step], after: [] });
  }

  for (const tree of trees) for (const step of tree.steps) step.rowHead = true;

  const edges: FlowEdge[] = [...actionEdges];
  for (const step of steps.values()) {
    if (!step.run || !step.stack?.input || step.panelIndex || graph.orphans.includes(step.stack.id)) continue;
    const input = step.stack.input;
    const inputRun = graph.runs.get(input);
    const from = step.run.sources.length ? step.run.sources : inputRun ? inputRun.outputs.map(o => o.key) : [input];
    // Not from the rows of the side panes (元ページ / コマ結合後): they are out of the flow.
    for (const key of from) {
      const at = stepOfCell.get(key);
      if (at && at !== pageRow && at !== mergeRow) edges.push({ from: key, to: step.id });
    }
  }
  return { trees, pageRow, mergeRow, edges, stepOfCell, steps };
}

/** The page shown split into panels (the first page with a コマ分割) and its shown コマ分割 run, or null. */
export function splitPageOf(graph: FlowGraph): { page: FlowImage; split: FlowRun } | null {
  for (const page of graph.roots) {
    const id = (graph.children.get(page.key) ?? []).find(i => graph.stacks.get(i)?.tool === SPLIT_TOOL);
    const stack = id ? graph.stacks.get(id) : undefined;
    if (stack) return { page, split: shownRun(graph, stack) };
  }
  return null;
}

/** The pages merged from the panels of `split` (コマ結合 results), newest first. */
export function pageMerges(graph: FlowGraph, split: FlowRun): FlowImage[] {
  return [...graph.runs.values()]
    .filter(r => r.tool === MERGE_TOOL && r.source === split.folder && r.outputs.length)
    .reverse()
    .map(r => r.outputs[0]);
}

/** Name of a result in a `row` box, and the image it was made from (its 原画). */
export interface RowLabel {
  /** "<tool> <n>" ("背景除去 1", "AI画像生成 2"): the n-th result of that tool in the box, left to right. */
  name: string;
  /** "原画" (the box's first image) or the name of the result it was made from. */
  from: string;
}

/** Labels of the cells of a `row` box: null for the 原画 (first cell) and for other layouts. */
export function rowLabels(step: FlowStep): (RowLabel | null)[] {
  if (step.layout !== 'row') return step.cells.map(() => null);
  const counts = new Map<string, number>();
  const names = step.cells.map((_cell, i) => {
    if (i === 0) return '原画';
    const tool = step.cellRuns[i]?.tool ?? '';
    const n = (counts.get(tool) ?? 0) + 1;
    counts.set(tool, n);
    return `${tool} ${n}`;
  });
  return step.cells.map((_cell, i) => {
    if (i === 0) return null;
    const source = step.cellRuns[i]?.source;
    const from = step.cells.findIndex(c => c.key === source);
    return { name: names[i], from: from >= 0 ? names[from] : '原画' };
  });
}

/**
 * What the generated image `step.cells[index]` can be compared with (docs/specs/flow-canvas.md 「原画との比較」):
 * the first image of its flow ("原画（01.png）"), then the other images generated in the same box
 * ("生成 1（gen.png）", the numbers of the cell labels). [] when the first image is unknown.
 */
export function compareTargets(graph: FlowGraph, step: FlowStep, index: number): { label: string; image: FlowImage }[] {
  const image = step.cells[index];
  const origin = image ? flowOrigin(graph, image.key) : null;
  if (!origin) return [];
  const labels = rowLabels(step);
  const generated = step.cells.flatMap((cell, i) => {
    const label = labels[i];
    return label && i !== index ? [{ label: `${label.name}（${cell.name}）`, image: cell }] : [];
  });
  return [{ label: `原画（${origin.name}）`, image: origin }, ...generated];
}

/** The imported page a split page's panels came from (null for other steps). */
export function hiddenPage(step: FlowStep): string | null {
  return step.panelIndex ? (step.page ?? null) : null;
}

/** The panels added by hand to the コマ分割 run `split` (its コマ追加 runs with an image), oldest first. */
export function addedPanels(graph: FlowGraph, split: FlowRun): FlowRun[] {
  const id = (graph.children.get(split.folder) ?? []).find(i => graph.stacks.get(i)?.tool === ADD_TOOL);
  return (id && graph.stacks.get(id)?.runs.filter(r => r.outputs.length)) || [];
}

/**
 * The panels of the コマ分割 run `split` in the order of their rows (docs/specs/flow-canvas.md 「コマの追加」): the
 * panels as split, with each added panel (oldest first) right after the panel it was added after (`settings.after`;
 * null: at the top). When that panel is gone, before `settings.before`, else at the bottom. Panels deleted one by
 * one (`removed`) are left out (they still place the panels added next to them).
 */
export function panelOrder(graph: FlowGraph, split: FlowRun): FlowImage[] {
  const order = [...split.outputs];
  for (const run of addedPanels(graph, split)) {
    const { after, before } = run.settings;
    const afterAt = typeof after === 'string' ? order.findIndex(p => p.key === after) : -1;
    const beforeAt = typeof before === 'string' ? order.findIndex(p => p.key === before) : -1;
    const at = typeof after !== 'string' ? 0 : afterAt >= 0 ? afterAt + 1 : beforeAt >= 0 ? beforeAt : order.length;
    order.splice(at, 0, run.outputs[0]);
  }
  return order.filter(p => !graph.removed.has(p.key));
}

/**
 * Where a panel added between the panels with the boxes `above` and `below` starts (docs/specs/flow-canvas.md
 * 「コマの追加」): their average (position and size). With one of them only (the top / the bottom), the same size
 * right above `below` / right below `above`, moved back onto the page (`pageHeight`). Null without either.
 */
export function newPanelBox(above: PageBox | null, below: PageBox | null, pageHeight: number): PageBox | null {
  if (above && below) return above.map((v, i) => Math.round((v + below[i]) / 2)) as PageBox;
  const next = above ?? below;
  if (!next) return null;
  const [xmin, ymin, xmax, ymax] = next;
  const height = ymax - ymin;
  const top = Math.max(0, Math.min(above ? ymax : ymin - height, pageHeight - height));
  return [xmin, top, xmax, top + height];
}

/**
 * Runs removed together with `folders` / the images `imageKeys` (docs/specs/flow-canvas.md 「削除」): those runs
 * and every run that used one of the removed images as input, in any stack (also the runs not shown).
 * Includes `folders`, oldest first.
 */
export function cascadeRuns(graph: FlowGraph, folders: readonly string[], imageKeys: readonly string[] = []): string[] {
  const removed = new Set<string>();
  const gone = new Set<string>(imageKeys);
  const remove = (run: FlowRun) => {
    removed.add(run.folder);
    gone.add(run.folder);
    for (const o of run.outputs) gone.add(o.key);
  };
  for (const folder of folders) {
    const run = graph.runs.get(folder);
    if (run) remove(run);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const run of graph.runs.values()) {
      if (!removed.has(run.folder) && usesAny(run, gone)) {
        remove(run);
        changed = true;
      }
    }
  }
  return [...graph.runs.keys()].filter(f => removed.has(f));
}

const usesAny = (run: FlowRun, keys: ReadonlySet<string>) =>
  (run.source !== null && keys.has(run.source)) || run.sources.some(s => keys.has(s));

/** The panel (an output of a コマ分割 or a コマ追加) that the image `key` is, or was made from; null for other images. */
export function panelOf(graph: FlowGraph, key: string): string | null {
  const seen = new Set<string>();
  let current = key;
  while (!seen.has(current)) {
    seen.add(current);
    const run = graph.runOfImage.get(current);
    if (!run) return null;
    if (run.tool === SPLIT_TOOL || run.tool === ADD_TOOL) return current;
    if (!run.source || !graph.images.has(run.source)) return null;
    current = run.source;
  }
  return null;
}

/**
 * What コマ結合 pastes for `panel` (docs/specs/tools/panel-split-merge.md): the image marked for it with 「最終」
 * (`marked`; it must still exist and be made from the shown version of the panel), else the shown version itself
 * (the 原画: the panel as split, or its re-cut).
 */
export function mergeChoice(graph: FlowGraph, panel: FlowImage): { key: string; marked: boolean } {
  const shown = shownVersion(graph, panel)?.image.key ?? panel.key;
  const marked = graph.merge[panel.key];
  const valid = !!marked && marked !== shown && graph.images.has(marked) && versionOf(graph, marked) === shown;
  return valid ? { key: marked, marked: true } : { key: shown, marked: false };
}

/**
 * What a side pane shows at its first stage (docs/specs/flow-canvas.md 「3 枚構成」): the image of its row
 * (`VisibleFlow.pageRow` / `mergeRow`) marked with 「最終」 (`marked`; it must still be in the row), else the row's
 * 原画 (the page, the merged page).
 */
export function rowFinal(graph: FlowGraph, row: FlowStep): { key: string; marked: boolean } {
  const page = row.cells[0];
  const marked = graph.merge[page.key];
  const valid = !!marked && marked !== page.key && row.cells.some(c => c.key === marked);
  return valid ? { key: marked, marked: true } : { key: page.key, marked: false };
}

/**
 * The 「最終」 image of each panel row (top to bottom): what コマ結合 pastes for it (`mergeChoice`). The Workspace's
 * 書き出し exports them when nothing is selected (docs/specs/flow-canvas.md 「画像の書き出し」).
 */
export function finalImages(graph: FlowGraph, panelRows: readonly FlowStep[]): string[] {
  return panelRows.flatMap(step => (step.panel ? [mergeChoice(graph, step.panel).key] : []));
}

/** Panels of a コマ分割 run to replace when merging (`mergeChoice` is not the panel). Panel file name -> image key. */
export function mergeOverrides(graph: FlowGraph, splitRun: FlowRun): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const panel of keptPanels(graph, splitRun)) {
    const choice = mergeChoice(graph, panel);
    if (choice.key !== panel.key) overrides[panel.name] = choice.key;
  }
  return overrides;
}

/** Boxes of the panels of a コマ分割 run whose shown version is a re-cut (panel file name -> box on the page). */
export function mergeBoxes(graph: FlowGraph, splitRun: FlowRun): Record<string, PageBox> {
  const boxes: Record<string, PageBox> = {};
  for (const panel of keptPanels(graph, splitRun)) {
    const box = shownVersion(graph, panel)?.box;
    if (box) boxes[panel.name] = box;
  }
  return boxes;
}

/** The panels of a コマ分割 run (as split) not deleted one by one. */
export const keptPanels = (graph: FlowGraph, splitRun: FlowRun): FlowImage[] =>
  splitRun.outputs.filter(p => !graph.removed.has(p.key));

/** File names of the panels of a コマ分割 run deleted one by one: コマ結合 leaves them out. */
export function mergeRemoved(graph: FlowGraph, splitRun: FlowRun): string[] {
  return splitRun.outputs.filter(p => graph.removed.has(p.key)).map(p => p.name);
}

/**
 * The panels added by hand to the コマ分割 run `splitRun` to paste when merging: what is pasted for each (`mergeChoice`)
 * and the box of its shown version on the page.
 */
export function mergeExtras(graph: FlowGraph, splitRun: FlowRun): { key: string; box: PageBox }[] {
  return addedPanels(graph, splitRun).flatMap(run => {
    const panel = run.outputs[0];
    const box = shownVersion(graph, panel)?.box;
    return box ? [{ key: mergeChoice(graph, panel).key, box }] : [];
  });
}

/** A panel row that コマ結合 pastes otherwise than as split / added (the merge tool window's card). */
export interface MergeReplacement {
  /** The row number in the Workspace ("コマ <n>"; rows move up after a deletion, down after an addition). */
  number: number;
  /** The image marked 「最終」 for it, named by its band ("背景除去 1"; else its file name), or null. */
  marked: string | null;
  /** The re-cut version shown ("切り直し 1"; pasted at its box), or null. */
  recut: string | null;
}

/**
 * The panel rows of the コマ分割 run `split` whose pasted image or box is not the panel's own
 * (docs/specs/tools/panel-split-merge.md 「コマ結合」), top to bottom. `flow` names the marked images by their bands.
 */
export function mergeReplacements(graph: FlowGraph, flow: VisibleFlow, split: FlowRun): MergeReplacement[] {
  return panelOrder(graph, split).flatMap((panel, i) => {
    const choice = mergeChoice(graph, panel);
    const version = shownVersion(graph, panel);
    const recut = version?.run.tool === RECROP_TOOL ? version.label : null;
    if (!choice.marked && !recut) return [];
    let marked: string | null = null;
    if (choice.marked) {
      const step = flow.stepOfCell.get(choice.key);
      const at = step ? step.cells.findIndex(c => c.key === choice.key) : -1;
      const band = step && at >= 0 ? rowLabels(step)[at]?.name : undefined;
      marked = band ?? graph.images.get(choice.key)?.name ?? choice.key;
    }
    return [{ number: i + 1, marked, recut }];
  });
}

/** The row numbers ("コマ <n>") of the panels added by hand to the コマ分割 run `split`, top to bottom. */
export function addedPanelNumbers(graph: FlowGraph, split: FlowRun): number[] {
  return panelOrder(graph, split).flatMap((panel, i) =>
    graph.runOfImage.get(panel.key)?.tool === ADD_TOOL ? [i + 1] : [],
  );
}

/** The nearest run of `tool` upstream of `key` (the image itself counts when that run made it). */
export function upstreamRun(graph: FlowGraph, key: string, tool: string): FlowRun | null {
  const seen = new Set<string>();
  let run = graph.runOfImage.get(key) ?? graph.runs.get(key);
  while (run && !seen.has(run.folder)) {
    if (run.tool === tool) return run;
    seen.add(run.folder);
    const input: string | null = run.source;
    run = input ? (graph.runOfImage.get(input) ?? graph.runs.get(input)) : undefined;
  }
  return null;
}

/** What deleting the selected images removes (docs/specs/flow-canvas.md 「削除」). */
export interface DeletionPlan {
  /** Everything in the archive goes: the archive itself is deleted. */
  whole: boolean;
  /** Imported pages selected. */
  roots: FlowImage[];
  /** Run folders removed: the runs of the selected images and everything downstream, oldest first. */
  runs: string[];
  /** How many of `runs` were not selected themselves (downstream results). */
  downstream: number;
  /**
   * Panels of a コマ分割 deleted one by one (marked, the コマ分割 stays): a panel as split selected, unless no other
   * panel row of its コマ分割 (added panels too) would be left (then the whole コマ分割 goes and the page comes back).
   */
  panels: string[];
}

/**
 * Deleting a selected output removes its whole run (all its outputs) and what was made from them; a panel as split
 * is deleted alone (`panels`), with what was made from it.
 */
export function planDeletion(graph: FlowGraph, keys: readonly string[]): DeletionPlan {
  const roots = graph.roots.filter(r => keys.includes(r.key));
  const panels: string[] = [];
  const runKeys: string[] = [];
  for (const key of keys) {
    const run = graph.runOfImage.get(key);
    const alone =
      run?.tool === SPLIT_TOOL &&
      !graph.removed.has(key) &&
      panelOrder(graph, run).some(p => p.key !== key && !keys.includes(p.key));
    if (alone) panels.push(key);
    else runKeys.push(key);
  }
  const selectedRuns = [...new Set(runKeys.map(k => graph.runOfImage.get(k)?.folder).filter((f): f is string => !!f))];
  const runs = cascadeRuns(graph, selectedRuns, [...roots.map(r => r.key), ...panels]);
  const whole = roots.length === graph.roots.length && runs.length === graph.runs.size;
  return { whole, roots, runs, downstream: runs.length - selectedRuns.length, panels };
}
