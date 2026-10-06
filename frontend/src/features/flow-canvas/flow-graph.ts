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
 */
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
}

/** Runs with the same input and tool are stacked; a run without input is a stack of its own. */
export function stackIdOf(run: Pick<FlowRun, 'source' | 'tool' | 'folder'>): string {
  return run.source ? `${run.source}|${run.tool}` : `|${run.tool}|${run.folder}`;
}

export function buildGraph(data: FlowData): FlowGraph {
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
  edges: FlowEdge[];
  /** Step of each shown image. */
  stepOfCell: Map<string, FlowStep>;
  steps: Map<string, FlowStep>;
}

/** Several runs that each made one image: shown side by side, one of them adopted (★). */
const isCandidateStack = (stack: FlowStack) => stack.runs.length > 1 && stack.runs.every(r => r.outputs.length === 1);

/** A run that rewrote its input image as 原画 (Nano Banana画像生成 with a 原画; info.json settings.original). */
export const isOriginalRun = (run: FlowRun) =>
  run.source !== null &&
  run.outputs.length === 1 &&
  typeof run.settings.original === 'object' &&
  !!run.settings.original;

/** The stack of `run` when the canvas lets the user adopt one of its runs (★), else null. */
export function adoptableStack(graph: FlowGraph, run: FlowRun | null): FlowStack | null {
  const stack = run && graph.stacks.get(graph.stackOfRun.get(run.folder) ?? '');
  return stack && isCandidateStack(stack) ? stack : null;
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
        if (!stack || steps.has(id) || absorbed.has(id) || !stack.runs.every(isOriginalRun)) continue;
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

  /** A page with a コマ分割: its panels as boxes of their own, the page and its other results apart. */
  const splitPage = (root: FlowImage): FlowTree[] | null => {
    const childIds = graph.children.get(root.key) ?? [];
    const splitId = childIds.find(id => graph.stacks.get(id)?.tool === SPLIT_TOOL);
    const stack = splitId ? graph.stacks.get(splitId) : undefined;
    if (!splitId || !stack) return null;
    const run = shownRun(graph, stack);
    const panels = run.outputs.map((cell, i) =>
      fillRow(
        register({
          id: `${splitId}#${i + 1}`,
          stack,
          run,
          layout: 'column',
          panelIndex: i + 1,
          cells: [cell],
          cellRuns: [run],
          cellChildren: [],
          runChildren: [],
        }),
      ),
    );
    const others = childIds
      .filter(id => id !== splitId)
      .map(stackStep)
      .filter((s): s is FlowStep => s !== null);
    // コマ結合 of the panels is shown in the right pane (pageMerges), not in the flow.
    return [{ steps: panels, after: [] }, ...others.map(step => ({ steps: [step], after: [] }))];
  };

  const trees: FlowTree[] = [];
  const actionEdges: FlowEdge[] = [];
  for (const root of graph.roots) {
    const split = splitPage(root);
    if (split) {
      trees.push(...split);
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
    for (const key of from) if (stepOfCell.has(key)) edges.push({ from: key, to: step.id });
  }
  return { trees, edges, stepOfCell, steps };
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

/** Name of an image generated in a `row` box, and the image it was generated from (its 原画). */
export interface RowLabel {
  /** "生成 <n>": the n-th generated image of the box, left to right. */
  name: string;
  /** "原画" (the box's first image) or the name of the generated image it was made from. */
  from: string;
}

/** Labels of the cells of a `row` box: null for the 原画 (first cell) and for other layouts. */
export function rowLabels(step: FlowStep): (RowLabel | null)[] {
  if (step.layout !== 'row') return step.cells.map(() => null);
  const nameOf = (i: number) => (i === 0 ? '原画' : `生成 ${i}`);
  return step.cells.map((_cell, i) => {
    if (i === 0) return null;
    const source = step.cellRuns[i]?.source;
    const from = step.cells.findIndex(c => c.key === source);
    return { name: nameOf(i), from: from >= 0 ? nameOf(from) : '原画' };
  });
}

/** The imported page a split page's panels came from (null for other steps). */
export function hiddenPage(step: FlowStep): string | null {
  return step.panelIndex && step.stack?.input ? step.stack.input : null;
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

/** The panel (an output of a コマ分割) that the image `key` is, or was made from; null for other images. */
export function panelOf(graph: FlowGraph, key: string): string | null {
  const seen = new Set<string>();
  let current = key;
  while (!seen.has(current)) {
    seen.add(current);
    const run = graph.runOfImage.get(current);
    if (!run) return null;
    if (run.tool === SPLIT_TOOL) return current;
    if (!run.source || !graph.images.has(run.source)) return null;
    current = run.source;
  }
  return null;
}

/**
 * What コマ結合 pastes for `panel` (docs/specs/tools/panel-split-merge.md): the image marked for it with 「結合」
 * (`marked`; it must still exist and be made from the panel), else the panel itself (the 原画).
 */
export function mergeChoice(graph: FlowGraph, panel: FlowImage): { key: string; marked: boolean } {
  const marked = graph.merge[panel.key];
  const valid = !!marked && marked !== panel.key && graph.images.has(marked) && panelOf(graph, marked) === panel.key;
  return valid ? { key: marked, marked: true } : { key: panel.key, marked: false };
}

/** Panels of a コマ分割 run to replace when merging (`mergeChoice` is not the panel). Panel file name -> image key. */
export function mergeOverrides(graph: FlowGraph, splitRun: FlowRun): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const panel of splitRun.outputs) {
    const choice = mergeChoice(graph, panel);
    if (choice.key !== panel.key) overrides[panel.name] = choice.key;
  }
  return overrides;
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
}

/** Deleting a selected output removes its whole run (all its outputs) and what was made from them. */
export function planDeletion(graph: FlowGraph, keys: readonly string[]): DeletionPlan {
  const roots = graph.roots.filter(r => keys.includes(r.key));
  const selectedRuns = [...new Set(keys.map(k => graph.runOfImage.get(k)?.folder).filter((f): f is string => !!f))];
  const runs = cascadeRuns(
    graph,
    selectedRuns,
    roots.map(r => r.key),
  );
  const whole = roots.length === graph.roots.length && runs.length === graph.runs.size;
  return { whole, roots, runs, downstream: runs.length - selectedRuns.length };
}
