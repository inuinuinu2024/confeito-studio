import { describe, expect, it } from 'vitest';
import type { FlowData, FlowImage, FlowRun } from '../../shared/types/flow';
import {
  buildGraph,
  cascadeRuns,
  hiddenPage,
  mergeChoice,
  pageMerges,
  splitPageOf,
  mergeOverrides,
  panelOf,
  planDeletion,
  rowLabels,
  shownRun,
  stackIdOf,
  upstreamRun,
  visibleFlow,
} from './flow-graph';
import { edgePath, layoutFlow, LAYOUT, stepHeight, stepWidth } from './flow-layout';

const img = (key: string): FlowImage => ({ key, name: key.split('/').pop()!, width: 10, height: 10 });

function run(
  folder: string,
  tool: string,
  source: string | null,
  outputs: string[],
  at: string,
  sources: string[] = [],
): FlowRun {
  return {
    folder: `a/${folder}`,
    tool,
    created_at: at,
    source,
    sources,
    settings: {},
    outputs: outputs.map(o => img(`a/${folder}/${o}`)),
  };
}

/**
 * page.png ─ 背景除去 (r1, r2: re-run) ─ r2 → 着彩 (c1)
 *          └ コマ分割 (s1: 01, 02) ─ 01 → 着彩 (p1) ; s1 → コマ結合 (m1)
 */
function sample(selection: Record<string, string> = {}): FlowData {
  return {
    archive: 'a',
    roots: [img('a/page.png')],
    runs: [
      run('r1', '背景除去', 'a/page.png', ['nobg.png'], '2026-01-01 10:00:00'),
      run('s1', 'コマ分割', 'a/page.png', ['01.png', '02.png'], '2026-01-01 10:01:00'),
      run('r2', '背景除去', 'a/page.png', ['nobg.png'], '2026-01-01 10:02:00'),
      run('c1', '着彩', 'a/r2/nobg.png', ['c.png'], '2026-01-01 10:03:00'),
      run('p1', '着彩', 'a/s1/01.png', ['p.png'], '2026-01-01 10:04:00'),
      run('m1', 'コマ結合', 'a/s1', ['m.png'], '2026-01-01 10:05:00', ['a/p1/p.png', 'a/s1/02.png']),
      run('x1', 'Nano Banana', null, ['gen.png'], '2026-01-01 10:06:00'),
      run('x2', '背景除去', 'a/gone.png', ['n.png'], '2026-01-01 10:07:00'),
    ],
    selection,
    merge: {},
  };
}

describe('buildGraph', () => {
  it('stacks re-runs of the same tool on the same input', () => {
    const graph = buildGraph(sample());
    const stack = graph.stacks.get('a/page.png|背景除去')!;
    expect(stack.runs.map(r => r.folder)).toEqual(['a/r1', 'a/r2']);
    expect(graph.children.get('a/page.png')).toEqual(['a/page.png|背景除去', 'a/page.png|コマ分割']);
    expect(graph.children.get('a/s1')).toEqual(['a/s1|コマ結合']);
  });

  it('keeps runs without a known input apart, each in its own stack', () => {
    const graph = buildGraph(sample());
    expect(graph.orphans).toEqual([stackIdOf(graph.runs.get('a/x1')!), 'a/gone.png|背景除去']);
    expect(stackIdOf(graph.runs.get('a/x1')!)).toBe('|Nano Banana|a/x1');
  });
});

describe('shownRun', () => {
  it('shows the newest run unless another one was picked', () => {
    const stack = buildGraph(sample()).stacks.get('a/page.png|背景除去')!;
    expect(shownRun(buildGraph(sample()), stack).folder).toBe('a/r2');
    const picked = buildGraph(sample({ 'a/page.png|背景除去': 'a/r1' }));
    expect(shownRun(picked, stack).folder).toBe('a/r1');
    const stale = buildGraph(sample({ 'a/page.png|背景除去': 'a/deleted' }));
    expect(shownRun(stale, stack).folder).toBe('a/r2');
  });
});

describe('visibleFlow', () => {
  const ids = (steps: { id: string }[]) => steps.map(s => s.id);

  it('shows re-runs with one output each side by side; only the adopted one feeds further steps', () => {
    const newest = visibleFlow(buildGraph(sample()));
    const stack = newest.steps.get('a/page.png|背景除去')!;
    expect(stack.layout).toBe('candidates');
    expect(stack.cells.map(c => c.key)).toEqual(['a/r1/nobg.png', 'a/r2/nobg.png']);
    expect(stack.run?.folder).toBe('a/r2');
    expect(stack.cellChildren.map(ids)).toEqual([[], ['a/r2/nobg.png|着彩']]);
    expect(newest.stepOfCell.has('a/c1/c.png')).toBe(true);

    const older = visibleFlow(buildGraph(sample({ 'a/page.png|背景除去': 'a/r1' })));
    expect(older.steps.get('a/page.png|背景除去')!.run?.folder).toBe('a/r1');
    expect(older.stepOfCell.has('a/c1/c.png')).toBe(false);
    expect(older.stepOfCell.has('a/r2/nobg.png')).toBe(true);
  });

  it('shows a split page as its panels, each a row of its own; its merges are not in the flow', () => {
    const flow = visibleFlow(buildGraph(sample()));
    expect(flow.stepOfCell.has('a/page.png')).toBe(false);
    expect(flow.trees.map(t => ids(t.steps))).toEqual([
      ['a/page.png|コマ分割#1', 'a/page.png|コマ分割#2'],
      // The page's other results start at the left too (the page is hidden).
      ['a/page.png|背景除去'],
      ['|Nano Banana|a/x1'],
      ['a/gone.png|背景除去'],
    ]);
    expect(ids(flow.trees[0].after)).toEqual([]);
    expect(flow.steps.has('a/s1|コマ結合')).toBe(false);
    const [first, second] = flow.trees[0].steps;
    expect([first.panelIndex, second.panelIndex]).toEqual([1, 2]);
    expect(first.cells.map(c => c.name)).toEqual(['01.png']);
    expect(ids(first.cellChildren[0])).toEqual(['a/s1/01.png|着彩']);
    expect(hiddenPage(first)).toBe('a/page.png');
  });

  it('shows a page without a split as a step, and re-split runs (several outputs) switched in a column', () => {
    const data = sample();
    data.runs = data.runs.filter(r => !['a/s1', 'a/p1', 'a/m1'].includes(r.folder));
    const unsplit = visibleFlow(buildGraph(data));
    expect(ids(unsplit.trees[0].steps)).toEqual(['root:a/page.png']);
    // The 「コマ分割」 button comes first right of the page, joined by an edge.
    const action = unsplit.trees[0].steps[0].cellChildren[0][0];
    expect([action.id, action.layout, action.splitPage]).toEqual(['split:a/page.png', 'action', 'a/page.png']);
    expect(unsplit.edges).toContainEqual({ from: 'a/page.png', to: 'split:a/page.png' });

    const resplit = sample();
    resplit.runs.push(run('s2', 'コマ分割', 'a/page.png', ['01.png', '02.png', '03.png'], '2026-01-01 13:00:00'));
    const flow = visibleFlow(buildGraph(resplit));
    expect(flow.trees[0].steps.map(s => [s.layout, s.run?.folder, s.cells[0].key])).toEqual([
      ['column', 'a/s2', 'a/s2/01.png'],
      ['column', 'a/s2', 'a/s2/02.png'],
      ['column', 'a/s2', 'a/s2/03.png'],
    ]);
  });

  it('draws edges from the input image, or from every image a merge used, never from a hidden page', () => {
    const { edges } = visibleFlow(buildGraph(sample()));
    expect(edges.some(e => e.from === 'a/page.png')).toBe(false);
    expect(edges).toContainEqual({ from: 'a/s1/01.png', to: 'a/s1/01.png|着彩' });
    expect(edges).toContainEqual({ from: 'a/r2/nobg.png', to: 'a/r2/nobg.png|着彩' });
    expect(edges.some(e => e.to === '|Nano Banana|a/x1' || e.to === 'a/gone.png|背景除去')).toBe(false);
  });

  it('puts images generated from an image as 原画 in its box, to its right', () => {
    const data = sample();
    const gen = (folder: string, source: string, at: string): FlowRun => ({
      ...run(folder, 'Nano Banana画像生成', source, ['g.png'], at),
      settings: { original: { width: 150, height: 200 } },
    });
    data.runs.push(
      gen('g1', 'a/s1/02.png', '2026-01-01 11:00:00'),
      gen('g2', 'a/s1/02.png', '2026-01-01 11:10:00'),
      gen('g3', 'a/g2/g.png', '2026-01-01 11:20:00'),
      run('b1', '背景除去', 'a/g2/g.png', ['b.png'], '2026-01-01 11:30:00'),
    );
    const flow = visibleFlow(buildGraph(data));
    const panel = flow.steps.get('a/page.png|コマ分割#2')!;
    expect(panel.layout).toBe('row');
    // The generations (oldest first) and the one generated from the adopted (newest) generation.
    expect(panel.cells.map(c => c.key)).toEqual(['a/s1/02.png', 'a/g1/g.png', 'a/g2/g.png', 'a/g3/g.png']);
    expect(panel.cellChildren.map(ids)).toEqual([[], [], ['a/g2/g.png|背景除去'], []]);
    expect(flow.steps.has('a/s1/02.png|Nano Banana画像生成')).toBe(false);
    expect(flow.edges.some(e => e.to.includes('Nano Banana'))).toBe(false);
    expect(flow.edges).toContainEqual({ from: 'a/g2/g.png', to: 'a/g2/g.png|背景除去' });
    expect(layoutFlow(flow).steps.get(panel.id)!.w).toBe(stepWidth(4));
    // Each generated image is named, with the image it was generated from.
    expect(rowLabels(panel)).toEqual([
      null,
      { name: '生成 1', from: '原画' },
      { name: '生成 2', from: '原画' },
      { name: '生成 3', from: '生成 2' },
    ]);
    expect(rowLabels(flow.steps.get('a/page.png|背景除去')!)).toEqual([null, null]);

    // Adopting the older generation hides what was made from the newer one.
    const older = visibleFlow(buildGraph({ ...data, selection: { 'a/s1/02.png|Nano Banana画像生成': 'a/g1' } }));
    expect(older.steps.get('a/page.png|コマ分割#2')!.cells.map(c => c.key)).toEqual([
      'a/s1/02.png',
      'a/g1/g.png',
      'a/g2/g.png',
    ]);
    expect(older.stepOfCell.has('a/b1/b.png')).toBe(false);
  });

  it('finds the split page and its merges (newest first) for the side panes', () => {
    const data = sample();
    data.runs.push(run('m2', 'コマ結合', 'a/s1', ['m2.png'], '2026-01-01 12:00:00'));
    const graph = buildGraph(data);
    const found = splitPageOf(graph)!;
    expect([found.page.key, found.split.folder]).toEqual(['a/page.png', 'a/s1']);
    expect(pageMerges(graph, found.split).map(m => m.key)).toEqual(['a/m2/m2.png', 'a/m1/m.png']);
    data.runs = data.runs.filter(r => r.tool !== 'コマ分割');
    expect(splitPageOf(buildGraph(data))).toBeNull();
  });
});

describe('cascadeRuns', () => {
  it('removes the run and everything fed by its outputs, shown or not', () => {
    const graph = buildGraph(sample({ 'a/page.png|背景除去': 'a/r1' }));
    expect(cascadeRuns(graph, ['a/r2'])).toEqual(['a/r2', 'a/c1']);
    expect(cascadeRuns(graph, ['a/s1'])).toEqual(['a/s1', 'a/p1', 'a/m1']);
    expect(cascadeRuns(graph, ['a/p1'])).toEqual(['a/p1', 'a/m1']);
  });

  it('removes what a deleted page fed', () => {
    const graph = buildGraph(sample());
    expect(cascadeRuns(graph, [], ['a/page.png'])).toEqual(['a/r1', 'a/s1', 'a/r2', 'a/c1', 'a/p1', 'a/m1']);
  });
});

describe('merge marks', () => {
  it('finds the panel an image is (or was made from)', () => {
    const graph = buildGraph(sample());
    expect(panelOf(graph, 'a/s1/01.png')).toBe('a/s1/01.png');
    expect(panelOf(graph, 'a/p1/p.png')).toBe('a/s1/01.png');
    expect(panelOf(graph, 'a/r1/nobg.png')).toBeNull();
    expect(panelOf(graph, 'a/m1/m.png')).toBeNull();
  });

  it('pastes the image marked 「結合」 for a panel, else the panel (原画) itself', () => {
    const data = sample();
    data.runs.push(run('p2', '着彩', 'a/s1/01.png', ['p2.png'], '2026-01-01 11:00:00'));
    // Nothing marked: every panel as split, even with images made from it.
    const unmarked = buildGraph(data);
    expect(mergeChoice(unmarked, img('a/s1/01.png'))).toEqual({ key: 'a/s1/01.png', marked: false });
    expect(mergeOverrides(unmarked, unmarked.runs.get('a/s1')!)).toEqual({});
    // Panel 01 marked with its older colored version; the mark of panel 02 is not made from it (ignored).
    const graph = buildGraph({ ...data, merge: { 'a/s1/01.png': 'a/p1/p.png', 'a/s1/02.png': 'a/r1/nobg.png' } });
    expect(mergeChoice(graph, img('a/s1/01.png'))).toEqual({ key: 'a/p1/p.png', marked: true });
    expect(mergeChoice(graph, img('a/s1/02.png'))).toEqual({ key: 'a/s1/02.png', marked: false });
    expect(mergeOverrides(graph, graph.runs.get('a/s1')!)).toEqual({ '01.png': 'a/p1/p.png' });
    // A mark on a deleted image counts as none.
    const deleted = buildGraph({ ...data, merge: { 'a/s1/01.png': 'a/gone/x.png' } });
    expect(mergeOverrides(deleted, deleted.runs.get('a/s1')!)).toEqual({});
  });
});

describe('upstreamRun', () => {
  it('finds the コマ分割 a panel (or something made from it) came from', () => {
    const graph = buildGraph(sample());
    expect(upstreamRun(graph, 'a/s1/02.png', 'コマ分割')?.folder).toBe('a/s1');
    expect(upstreamRun(graph, 'a/p1/p.png', 'コマ分割')?.folder).toBe('a/s1');
    expect(upstreamRun(graph, 'a/r1/nobg.png', 'コマ分割')).toBeNull();
    expect(upstreamRun(graph, 'a/page.png', 'コマ分割')).toBeNull();
  });
});

describe('layoutFlow', () => {
  it('makes a row per panel: label column on the left, next steps level with their image', () => {
    const layout = layoutFlow(visibleFlow(buildGraph(sample())));
    const at = (id: string) => layout.steps.get(id)!;
    const { margin, gutter, columnGap, rowGap } = LAYOUT;
    const [p1, p2] = [at('a/page.png|コマ分割#1'), at('a/page.png|コマ分割#2')];
    expect([p1.x, p2.x]).toEqual([margin + gutter, margin + gutter]);
    // The next step follows right after the panel (each row is packed on its own).
    const colored = at('a/s1/01.png|着彩');
    expect([colored.x, colored.y]).toEqual([p1.x + stepWidth(1) + columnGap, p1.y]);
    expect(layout.cells.get('a/p1/p.png')!.y).toBe(layout.cells.get('a/s1/01.png')!.y);
    // The next panel row starts below everything of the first one.
    expect(p2.y).toBe(p1.y + stepHeight(1) + rowGap);
    // One row per panel, then the other trees.
    expect(layout.rows.map(r => r.id)).toEqual([
      'a/page.png|コマ分割#1',
      'a/page.png|コマ分割#2',
      'a/page.png|背景除去',
      '|Nano Banana|a/x1',
      'a/gone.png|背景除去',
    ]);
    expect(layout.rows[0]).toEqual({ id: 'a/page.png|コマ分割#1', y: p1.y, h: stepHeight(1) });
  });

  it('places candidates side by side in one step', () => {
    const layout = layoutFlow(visibleFlow(buildGraph(sample())));
    const box = layout.steps.get('a/page.png|背景除去')!;
    expect([box.w, box.h]).toEqual([stepWidth(2), stepHeight(1)]);
    const [a, b] = [layout.cells.get('a/r1/nobg.png')!, layout.cells.get('a/r2/nobg.png')!];
    expect(a.y).toBe(b.y);
    expect(b.x).toBe(a.x + LAYOUT.cellWidth + LAYOUT.cellGap);
    // The adopted candidate's next step is in the next column, level with it.
    expect(layout.cells.get('a/c1/c.png')!.y).toBe(a.y);
    // Rows do not overlap.
    expect(box.y).toBeGreaterThan(layout.steps.get('a/page.png|コマ分割#2')!.y + stepHeight(1));
  });

  it('is empty without trees', () => {
    expect(layoutFlow({ trees: [], edges: [], stepOfCell: new Map(), steps: new Map() })).toMatchObject({
      width: 0,
      height: 0,
    });
  });
});

describe('edgePath', () => {
  it('is a straight line at the same height and bends in the gap otherwise', () => {
    const from = { x: 0, y: 0, w: 100, h: 40 };
    expect(edgePath(from, { x: 200, y: 0, w: 100, h: 40 }, 20)).toBe('M 100 20 H 200');
    expect(edgePath(from, { x: 200, y: 100, w: 100, h: 40 }, 120)).toBe(
      'M 100 20 H 156 Q 164 20 164 28 V 112 Q 164 120 172 120 H 200',
    );
  });
});

describe('planDeletion', () => {
  it('removes the runs of the selected outputs and their downstream results', () => {
    const graph = buildGraph(sample());
    expect(planDeletion(graph, ['a/s1/02.png'])).toEqual({
      whole: false,
      roots: [],
      runs: ['a/s1', 'a/p1', 'a/m1'],
      downstream: 2,
    });
  });

  it('deletes the whole archive when the page and every run go', () => {
    const graph = buildGraph(sample());
    expect(planDeletion(graph, ['a/page.png']).whole).toBe(false); // runs without input stay
    const data = sample();
    data.runs = data.runs.filter(r => r.source !== null && r.source !== 'a/gone.png');
    const plan = planDeletion(buildGraph(data), ['a/page.png']);
    expect(plan.whole).toBe(true);
    expect(plan.downstream).toBe(6);
  });
});
