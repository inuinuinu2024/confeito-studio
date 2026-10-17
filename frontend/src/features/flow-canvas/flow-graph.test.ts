import { describe, expect, it } from 'vitest';
import type { FlowData, FlowImage, FlowRun } from '../../shared/types/flow';
import {
  adoptableStack,
  buildGraph,
  cascadeRuns,
  compareTargets,
  finalImages,
  flowOrigin,
  hiddenPage,
  mergeBoxes,
  mergeChoice,
  rowFinal,
  pageMerges,
  splitPageOf,
  mergeExtras,
  mergeOverrides,
  mergeRemoved,
  newPanelBox,
  type PageBox,
  panelOf,
  panelOrder,
  panelVersions,
  planDeletion,
  rowLabels,
  shownRun,
  shownVersion,
  stackIdOf,
  upstreamRun,
  versionOf,
  visibleFlow,
} from './flow-graph';
import { edgePath, layoutFlow, LAYOUT, panelGaps, stepHeight, stepWidth } from './flow-layout';

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

/**
 * Candidates: the 背景除去 re-runs (q1, q2) of an image that cannot take them in its box (one of the several outputs
 * of k1), and 着彩 (q3) of the newer one. k1 is made from the split page, so it is a row without input.
 */
function candidates(selection: Record<string, string> = {}): FlowData {
  const data = sample(selection);
  data.runs.push(
    run('k1', 'トリミング', 'a/page.png', ['a.png', 'b.png'], '2026-01-01 11:00:00'),
    run('q1', '背景除去', 'a/k1/a.png', ['n.png'], '2026-01-01 11:01:00'),
    run('q2', '背景除去', 'a/k1/a.png', ['n.png'], '2026-01-01 11:02:00'),
    run('q3', '着彩', 'a/q2/n.png', ['c.png'], '2026-01-01 11:03:00'),
  );
  return data;
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
    const newest = visibleFlow(buildGraph(candidates()));
    const stack = newest.steps.get('a/k1/a.png|背景除去')!;
    expect(stack.layout).toBe('candidates');
    expect(stack.cells.map(c => c.key)).toEqual(['a/q1/n.png', 'a/q2/n.png']);
    expect(stack.run?.folder).toBe('a/q2');
    expect(stack.cellChildren.map(ids)).toEqual([[], ['a/q2/n.png|着彩']]);
    expect(newest.stepOfCell.has('a/q3/c.png')).toBe(true);

    const older = visibleFlow(buildGraph(candidates({ 'a/k1/a.png|背景除去': 'a/q1' })));
    expect(older.steps.get('a/k1/a.png|背景除去')!.run?.folder).toBe('a/q1');
    expect(older.stepOfCell.has('a/q3/c.png')).toBe(false);
    expect(older.stepOfCell.has('a/q2/n.png')).toBe(true);
  });

  it('shows a split page as its panels, each a row of its own; its merges are not in the flow', () => {
    const flow = visibleFlow(buildGraph(candidates()));
    expect(flow.trees.map(t => ids(t.steps))).toEqual([
      ['a/page.png|コマ分割#1', 'a/page.png|コマ分割#2'],
      // The page's results of several images start at the left too (the page is not in the flow).
      ['a/page.png|トリミング'],
      ['|Nano Banana|a/x1'],
      ['a/gone.png|背景除去'],
    ]);
    // The page and its results one image at a time (背景除去 re-runs, 着彩 of the adopted one) are the page's row,
    // shown in the 元ページ pane: in no tree, the panels' コマ分割 not in it.
    const row = flow.pageRow!;
    expect([row.id, row.layout]).toEqual(['page:a/page.png', 'row']);
    expect(row.cells.map(c => c.key)).toEqual(['a/page.png', 'a/r1/nobg.png', 'a/r2/nobg.png', 'a/c1/c.png']);
    expect(rowLabels(row)).toEqual([
      null,
      { name: '背景除去 1', from: '原画' },
      { name: '背景除去 2', from: '原画' },
      { name: '着彩 1', from: '背景除去 2' },
    ]);
    expect(flow.trees.some(t => t.steps.includes(row))).toBe(false);
    expect(flow.stepOfCell.get('a/page.png')).toBe(row);
    expect(flow.steps.has('a/page.png|背景除去')).toBe(false);
    // Without anything made from it, the page is still a row (its 原画).
    const bare = sample();
    bare.runs = bare.runs.filter(r => !['a/r1', 'a/r2', 'a/c1'].includes(r.folder));
    const alone = visibleFlow(buildGraph(bare)).pageRow!;
    expect([alone.layout, alone.cells.length]).toEqual(['row', 1]);
    expect(visibleFlow(buildGraph({ ...sample(), roots: [], runs: [] })).pageRow).toBeNull();
    expect(ids(flow.trees[0].after)).toEqual([]);
    expect(flow.steps.has('a/s1|コマ結合')).toBe(false);
    const [first, second] = flow.trees[0].steps;
    expect([first.panelIndex, second.panelIndex]).toEqual([1, 2]);
    // Any tool's one image joins the row of the image it was made from (here 着彩 of panel 1).
    expect(first.layout).toBe('row');
    expect(first.cells.map(c => c.name)).toEqual(['01.png', 'p.png']);
    expect(first.cellChildren.map(ids)).toEqual([[], []]);
    expect(hiddenPage(first)).toBe('a/page.png');
  });

  it('shows a page not split yet as the page row, and re-split runs (several outputs) switched in a column', () => {
    const data = sample();
    data.runs = data.runs.filter(r => !['a/s1', 'a/p1', 'a/m1'].includes(r.folder));
    const unsplit = visibleFlow(buildGraph(data));
    // Nothing split: the page and its results one image at a time are the page's row (shown like 元ページ), no merge.
    expect(unsplit.pageRow!.cells.map(c => c.key)).toEqual([
      'a/page.png',
      'a/r1/nobg.png',
      'a/r2/nobg.png',
      'a/c1/c.png',
    ]);
    expect(unsplit.mergeRow).toBeNull();
    expect(unsplit.trees.map(t => ids(t.steps))).toEqual([['|Nano Banana|a/x1'], ['a/gone.png|背景除去']]);
    // Several pages not split: each a step in the flow, the 「コマ分割」 button first right of it, joined by an edge.
    const two = visibleFlow(buildGraph({ ...data, roots: [...data.roots, img('a/page2.png')] }));
    expect(two.pageRow).toBeNull();
    const second = two.trees.find(t => t.steps[0].id === 'root:a/page2.png')!.steps[0];
    const action = second.cellChildren[0][0];
    expect([action.id, action.layout, action.splitPage]).toEqual(['split:a/page2.png', 'action', 'a/page2.png']);
    expect(two.edges).toContainEqual({ from: 'a/page2.png', to: 'split:a/page2.png' });

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
    const { edges } = visibleFlow(buildGraph(candidates()));
    // Not from the page's row (the 元ページ pane), even to what it fed in the flow (トリミング).
    expect(edges.some(e => e.from === 'a/page.png')).toBe(false);
    expect(edges.some(e => e.from === 'a/s1/01.png')).toBe(false); // 着彩 is in the panel's row: no edge
    expect(edges).toContainEqual({ from: 'a/k1/a.png', to: 'a/k1/a.png|背景除去' });
    expect(edges).toContainEqual({ from: 'a/q2/n.png', to: 'a/q2/n.png|着彩' });
    expect(edges.some(e => e.to === '|Nano Banana|a/x1' || e.to === 'a/gone.png|背景除去')).toBe(false);
  });

  it("puts every tool's one image in the box of the image it was made from, to its right", () => {
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
    // The generations (oldest first), then what was made from the adopted (newest) one: a generation and a 背景除去.
    expect(panel.cells.map(c => c.key)).toEqual([
      'a/s1/02.png',
      'a/g1/g.png',
      'a/g2/g.png',
      'a/g3/g.png',
      'a/b1/b.png',
    ]);
    expect(panel.cellChildren.map(ids)).toEqual([[], [], [], [], []]);
    expect(flow.steps.has('a/s1/02.png|AI画像生成')).toBe(false);
    expect(flow.edges.some(e => e.to.includes('画像生成') || e.to.includes('背景除去'))).toBe(false);
    // A wider gap after the 原画 (the ▶ between it and the generated images), the usual gap between the others.
    const layout = layoutFlow(flow);
    expect(layout.steps.get(panel.id)!.w).toBe(stepWidth(5, true));
    const [p, g1, g2] = ['a/s1/02.png', 'a/g1/g.png', 'a/g2/g.png'].map(k => layout.cells.get(k)!);
    expect(g1.x).toBe(p.x + LAYOUT.cellWidth + LAYOUT.originGap);
    expect(g2.x).toBe(g1.x + LAYOUT.cellWidth + LAYOUT.cellGap);
    // Each result is named by its tool (numbered per tool), with the image it was made from; the runs saved as
    // 「Nano Banana画像生成」 are shown as 「AI画像生成」.
    expect(rowLabels(panel)).toEqual([
      null,
      { name: 'AI画像生成 1', from: '原画' },
      { name: 'AI画像生成 2', from: '原画' },
      { name: 'AI画像生成 3', from: 'AI画像生成 2' },
      { name: '背景除去 1', from: 'AI画像生成 2' },
    ]);

    // Adopting the older generation hides what was made from the newer one (a choice saved under the old name).
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

  it('makes the shown merge and what was made from it a row of its own (the コマ結合後 pane), merges switched with ‹ ›', () => {
    const data = sample();
    data.runs.push(
      run('m2', 'コマ結合', 'a/s1', ['m2.png'], '2026-01-01 12:00:00'),
      run('b2', '背景除去', 'a/m2/m2.png', ['b.png'], '2026-01-01 12:01:00'),
      run('b1', '背景除去', 'a/m1/m.png', ['b.png'], '2026-01-01 12:02:00'),
    );
    const flow = visibleFlow(buildGraph(data));
    const row = flow.mergeRow!;
    // The newest merge, its 背景除去 to its right; not in the flow, no edges from it.
    expect([row.id, row.layout, row.run?.folder]).toEqual(['merge:a/s1|コマ結合', 'row', 'a/m2']);
    expect(row.cells.map(c => c.key)).toEqual(['a/m2/m2.png', 'a/b2/b.png']);
    expect(flow.trees.some(t => t.steps.includes(row))).toBe(false);
    expect(flow.edges.some(e => e.from === 'a/m2/m2.png')).toBe(false);
    // The merges are switched with ‹ › (the stack's runs), not adopted with ★.
    expect(row.stack?.runs.map(r => r.folder)).toEqual(['a/m1', 'a/m2']);
    expect(adoptableStack(buildGraph(data), row.run)).toBeNull();
    const older = visibleFlow(buildGraph({ ...data, selection: { 'a/s1|コマ結合': 'a/m1' } })).mergeRow!;
    expect(older.cells.map(c => c.key)).toEqual(['a/m1/m.png', 'a/b1/b.png']);
    // Without a merge: none.
    expect(
      visibleFlow(buildGraph({ ...sample(), runs: sample().runs.filter(r => r.tool !== 'コマ結合') })).mergeRow,
    ).toBeNull();
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

  it('pastes the image marked 「最終」 for a panel, else the panel (原画) itself', () => {
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

  it('shows the image of the page row marked 「最終」 in the 元ページ pane, else the page', () => {
    const final = (merge: Record<string, string>) => {
      const graph = buildGraph({ ...sample(), merge });
      return rowFinal(graph, visibleFlow(graph).pageRow!);
    };
    expect(final({})).toEqual({ key: 'a/page.png', marked: false });
    expect(final({ 'a/page.png': 'a/c1/c.png' })).toEqual({ key: 'a/c1/c.png', marked: true });
    // An image not in the page's row (a panel's), or deleted, counts as none.
    expect(final({ 'a/page.png': 'a/p1/p.png' })).toEqual({ key: 'a/page.png', marked: false });
    expect(final({ 'a/page.png': 'a/gone/x.png' })).toEqual({ key: 'a/page.png', marked: false });
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
    const { margin, gutter, rowGap } = LAYOUT;
    const [p1, p2] = [at('a/page.png|コマ分割#1'), at('a/page.png|コマ分割#2')];
    expect([p1.x, p2.x]).toEqual([margin + gutter, margin + gutter]);
    // The panel's 着彩 is in its row, right of it.
    const [panel1, colored] = [layout.cells.get('a/s1/01.png')!, layout.cells.get('a/p1/p.png')!];
    expect([colored.x, colored.y]).toEqual([panel1.x + LAYOUT.cellWidth + LAYOUT.originGap, panel1.y]);
    expect(p1.w).toBe(stepWidth(2, true));
    // The 全コマ header above the panel rows (close to the toolbar); the tools at the left of the free room of each row
    // (right after its images) and of the header (where the rows' images start).
    expect(p1.y).toBe(LAYOUT.topMargin + LAYOUT.panelHeader);
    expect(layout.panelTools).toEqual({
      header: { x: margin + gutter + LAYOUT.padding, y: LAYOUT.topMargin, h: LAYOUT.panelHeader - rowGap },
      rows: [
        { id: 'a/page.png|コマ分割#1', x: p1.x + p1.w + LAYOUT.toolsGap, y: p1.y + LAYOUT.padding },
        { id: 'a/page.png|コマ分割#2', x: p2.x + p2.w + LAYOUT.toolsGap, y: p2.y + LAYOUT.padding },
      ],
    });
    expect(layoutFlow(visibleFlow(buildGraph({ ...sample(), runs: [] }))).panelTools).toBeNull();
    // A row's first step has no heading (the row label): its images start right below the row's line.
    expect(panel1.y).toBe(p1.y + LAYOUT.padding);
    // The next panel row starts below everything of the first one.
    expect(p2.y).toBe(p1.y + stepHeight(1, false) + rowGap);
    // One row per panel, then the other trees.
    expect(layout.rows.map(r => r.id)).toEqual([
      'a/page.png|コマ分割#1',
      'a/page.png|コマ分割#2',
      '|Nano Banana|a/x1',
      'a/gone.png|背景除去',
    ]);
    expect(layout.rows[0]).toEqual({ id: 'a/page.png|コマ分割#1', y: p1.y, h: stepHeight(1, false) });
  });

  it('places candidates side by side in one step', () => {
    const flow = visibleFlow(buildGraph(candidates()));
    const layout = layoutFlow(flow);
    const box = layout.steps.get('a/k1/a.png|背景除去')!;
    const [a, b] = [layout.cells.get('a/q1/n.png')!, layout.cells.get('a/q2/n.png')!];
    expect(box.w).toBe(stepWidth(2));
    expect(a.y).toBe(b.y);
    expect(b.x).toBe(a.x + LAYOUT.cellWidth + LAYOUT.cellGap);
    // The adopted candidate's next step is in the next column, its images level with the candidates'.
    expect(layout.cells.get('a/q3/c.png')!.y).toBe(a.y);
    // Rows do not overlap; the page's row (the 元ページ pane) is not laid out.
    expect(box.y).toBeGreaterThan(layout.steps.get('a/page.png|コマ分割#2')!.y + stepHeight(1, false));
    expect(layout.steps.has(flow.pageRow!.id)).toBe(false);
    expect(layout.cells.has('a/page.png')).toBe(false);
  });

  it('is empty without trees', () => {
    expect(
      layoutFlow({ trees: [], pageRow: null, mergeRow: null, edges: [], stepOfCell: new Map(), steps: new Map() }),
    ).toMatchObject({
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
    expect(planDeletion(graph, ['a/r2/nobg.png'])).toEqual({
      whole: false,
      roots: [],
      runs: ['a/r2', 'a/c1'],
      downstream: 1,
      panels: [],
    });
  });

  it('deletes a panel as split alone (marked), with what was made from it', () => {
    const graph = buildGraph(sample());
    expect(planDeletion(graph, ['a/s1/01.png'])).toEqual({
      whole: false,
      roots: [],
      runs: ['a/p1', 'a/m1'],
      downstream: 2,
      panels: ['a/s1/01.png'],
    });
  });

  it('deletes the whole コマ分割 when no other panel row would be left', () => {
    const graph = buildGraph(sample());
    const both = planDeletion(graph, ['a/s1/01.png', 'a/s1/02.png']);
    expect(both.panels).toEqual([]);
    expect(both.runs).toEqual(['a/s1', 'a/p1', 'a/m1']);
    graph.removed.add('a/s1/01.png');
    expect(planDeletion(graph, ['a/s1/02.png']).runs).toEqual(['a/s1', 'a/p1', 'a/m1']);
    // A panel added by hand keeps the コマ分割: the panel as split goes alone.
    const data = sample();
    data.runs.push({
      ...run('a1', 'コマ追加', 'a/s1', ['panel.png'], '2026-01-02 10:00:00'),
      settings: { pixel_box: [0, 0, 5, 5], after: 'a/s1/02.png', before: null },
    });
    data.removed = { 'a/s1/01.png': '2026-01-03 10:00:00' };
    expect(planDeletion(buildGraph(data), ['a/s1/02.png']).panels).toEqual(['a/s1/02.png']);
  });

  it('leaves the panels deleted one by one out of the rows and コマ結合', () => {
    const data = sample();
    data.runs.push({
      ...run('a1', 'コマ追加', 'a/s1', ['panel.png'], '2026-01-02 10:00:00'),
      settings: { pixel_box: [0, 0, 5, 5], after: 'a/s1/01.png', before: 'a/s1/02.png' },
    });
    data.removed = { 'a/s1/01.png': '2026-01-03 10:00:00' };
    const graph = buildGraph(data);
    const rows = visibleFlow(graph).trees[0].steps;
    // The added panel still goes where it was added (after the deleted panel), the numbers follow the rows.
    expect(rows.map(s => [s.panelIndex, s.cells[0].key])).toEqual([
      [1, 'a/a1/panel.png'],
      [2, 'a/s1/02.png'],
    ]);
    const split = graph.runs.get('a/s1')!;
    expect(mergeRemoved(graph, split)).toEqual(['01.png']);
    graph.merge['a/s1/01.png'] = 'a/p1/p.png';
    expect(mergeOverrides(graph, split)).toEqual({});
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

describe('flowOrigin', () => {
  /** sample() + images generated from 原画: c1's output (g1), then g1's output (g2), and the panel 01 (g3). */
  function generated(): FlowData {
    const data = sample();
    const gen = (folder: string, source: string, at: string) => ({
      ...run(folder, 'Nano Banana画像生成', source, ['g.png'], at),
      settings: { original: { name: 'original.png' } },
    });
    data.runs.push(
      gen('g1', 'a/c1/c.png', '2026-01-01 12:00:00'),
      gen('g2', 'a/g1/g.png', '2026-01-01 12:01:00'),
      gen('g3', 'a/s1/01.png', '2026-01-01 12:02:00'),
      gen('g4', 'a/x1/gen.png', '2026-01-01 12:03:00'),
    );
    return data;
  }

  it('follows the inputs back to the start image', () => {
    const graph = buildGraph(generated());
    expect(flowOrigin(graph, 'a/g2/g.png')?.key).toBe('a/page.png');
    expect(flowOrigin(graph, 'a/c1/c.png')?.key).toBe('a/page.png');
  });

  it('stops at the panel of a split page', () => {
    const graph = buildGraph(generated());
    expect(flowOrigin(graph, 'a/g3/g.png')?.key).toBe('a/s1/01.png');
    expect(flowOrigin(graph, 'a/p1/p.png')?.key).toBe('a/s1/01.png');
  });

  it('stops at a result whose input is unknown', () => {
    const graph = buildGraph(generated());
    expect(flowOrigin(graph, 'a/g4/g.png')?.key).toBe('a/x1/gen.png');
    expect(flowOrigin(graph, 'a/x1/gen.png')).toBeNull();
    expect(flowOrigin(graph, 'a/x2/n.png')).toBeNull(); // its input was deleted
  });

  it('lists the 原画 first, then the other images generated in the same box', () => {
    const graph = buildGraph(generated());
    const flow = visibleFlow(graph);
    const targets = (key: string) => {
      const step = flow.stepOfCell.get(key)!;
      return compareTargets(
        graph,
        step,
        step.cells.findIndex(c => c.key === key),
      ).map(t => [t.label, t.image.key]);
    };
    // The page's row (the 元ページ pane): the 背景除去 re-runs, 着彩 of the newer one, then AI画像生成 1 (g1) and 2 (g2);
    // the 原画 is the page.
    expect(targets('a/g2/g.png')).toEqual([
      ['原画（page.png）', 'a/page.png'],
      ['背景除去 1（nobg.png）', 'a/r1/nobg.png'],
      ['背景除去 2（nobg.png）', 'a/r2/nobg.png'],
      ['着彩 1（c.png）', 'a/c1/c.png'],
      ['AI画像生成 1（g.png）', 'a/g1/g.png'],
    ]);
    expect(targets('a/g1/g.png').map(([label]) => label)).toEqual([
      '原画（page.png）',
      '背景除去 1（nobg.png）',
      '背景除去 2（nobg.png）',
      '着彩 1（c.png）',
      'AI画像生成 2（g.png）',
    ]);
    // Panel 01's box: its 着彩 (any tool) and the generation.
    expect(targets('a/g3/g.png')).toEqual([
      ['原画（01.png）', 'a/s1/01.png'],
      ['着彩 1（p.png）', 'a/p1/p.png'],
    ]);
    expect(targets('a/s1/01.png')).toEqual([]); // the first image itself
  });

  it('is null for the first image itself', () => {
    const graph = buildGraph(generated());
    expect(flowOrigin(graph, 'a/page.png')).toBeNull();
    expect(flowOrigin(graph, 'a/s1/01.png')).toBeNull();
  });
});

describe('panel versions (コマ切り直し)', () => {
  /** sample() + two re-cuts of panel 01 (k1, k2) and a 着彩 of the newest re-cut (q1). */
  function recut(selection: Record<string, string> = {}, merge: Record<string, string> = {}): FlowData {
    const data = sample(selection);
    const cut = (folder: string, at: string, box: unknown) => ({
      ...run(folder, 'コマ切り直し', 'a/s1/01.png', ['01.png'], at),
      settings: { split: 'a/s1', panel: '01.png', pixel_box: box },
    });
    data.runs.push(
      cut('k1', '2026-01-01 11:00:00', [0, 0, 6, 10]),
      cut('k2', '2026-01-01 11:01:00', 'broken'),
      run('q1', '着彩', 'a/k2/01.png', ['q.png'], '2026-01-01 11:02:00'),
    );
    return { ...data, merge };
  }
  const stackId = 'a/s1/01.png|コマ切り直し';
  const panel = img('a/s1/01.png');

  it('lists the panel as split and its re-cuts, oldest first', () => {
    const { versions, stackId: id } = panelVersions(buildGraph(recut()), panel);
    expect(id).toBe(stackId);
    expect(versions.map(v => [v.label, v.image.key, v.box])).toEqual([
      ['分割時', 'a/s1/01.png', null],
      ['切り直し 1', 'a/k1/01.png', [0, 0, 6, 10]],
      ['切り直し 2', 'a/k2/01.png', null],
    ]);
    expect(panelVersions(buildGraph(sample()), panel)).toMatchObject({ stackId: null });
  });

  it('shows the newest version unless another one (or the panel as split) was picked', () => {
    expect(shownVersion(buildGraph(recut()), panel)?.label).toBe('切り直し 2');
    expect(shownVersion(buildGraph(recut({ [stackId]: 'a/k1' })), panel)?.label).toBe('切り直し 1');
    expect(shownVersion(buildGraph(recut({ [stackId]: 'a/s1' })), panel)?.label).toBe('分割時');
    expect(shownVersion(buildGraph(recut({ [stackId]: 'a/deleted' })), panel)?.label).toBe('切り直し 2');
  });

  it("puts the shown version in the panel's row, with only what was made from it", () => {
    const flow = visibleFlow(buildGraph(recut()));
    const row = flow.steps.get('a/page.png|コマ分割#1')!;
    expect(row.cells.map(c => c.key)).toEqual(['a/k2/01.png', 'a/q1/q.png']);
    expect(row.panel?.key).toBe('a/s1/01.png');
    expect(flow.stepOfCell.has('a/p1/p.png')).toBe(false); // made from the panel as split: hidden
    expect(flow.steps.has(stackId)).toBe(false); // the re-cuts are not a step of their own

    const asSplit = visibleFlow(buildGraph(recut({ [stackId]: 'a/s1' })));
    const back = asSplit.steps.get('a/page.png|コマ分割#1')!;
    expect(back.cells.map(c => c.key)).toEqual(['a/s1/01.png', 'a/p1/p.png']);
    expect(asSplit.stepOfCell.has('a/p1/p.png')).toBe(true); // shown again
    expect(asSplit.stepOfCell.has('a/q1/q.png')).toBe(false);
  });

  it('finds the version an image was made from, and the panel through it', () => {
    const graph = buildGraph(recut());
    expect(versionOf(graph, 'a/q1/q.png')).toBe('a/k2/01.png');
    expect(versionOf(graph, 'a/p1/p.png')).toBe('a/s1/01.png');
    expect(versionOf(graph, 'a/page.png')).toBeNull();
    expect(panelOf(graph, 'a/q1/q.png')).toBe('a/s1/01.png');
    expect(upstreamRun(graph, 'a/q1/q.png', 'コマ分割')?.folder).toBe('a/s1');
    expect(adoptableStack(graph, graph.runs.get('a/k1')!)).toBeNull();
  });

  it('compares an image with the version its flow starts from', () => {
    expect(flowOrigin(buildGraph(recut()), 'a/q1/q.png')?.key).toBe('a/k2/01.png');
  });

  it('merges the shown version: its image at its box, marks only from it', () => {
    const split = (g: ReturnType<typeof buildGraph>) => g.runs.get('a/s1')!;
    const shownK1 = buildGraph(recut({ [stackId]: 'a/k1' }));
    expect(mergeChoice(shownK1, panel)).toEqual({ key: 'a/k1/01.png', marked: false });
    expect(mergeOverrides(shownK1, split(shownK1))).toEqual({ '01.png': 'a/k1/01.png' });
    expect(mergeBoxes(shownK1, split(shownK1))).toEqual({ '01.png': [0, 0, 6, 10] });

    // A mark on an image made from another version waits until that version is shown again.
    const merge = { 'a/s1/01.png': 'a/q1/q.png' };
    expect(mergeChoice(buildGraph(recut({}, merge)), panel)).toEqual({ key: 'a/q1/q.png', marked: true });
    const asSplit = buildGraph(recut({ [stackId]: 'a/s1' }, merge));
    expect(mergeChoice(asSplit, panel)).toEqual({ key: 'a/s1/01.png', marked: false });
    expect(mergeOverrides(asSplit, split(asSplit))).toEqual({});
    expect(mergeBoxes(asSplit, split(asSplit))).toEqual({});
  });
});

describe('panels added by hand (コマ追加)', () => {
  /** The sample with panels added to the コマ分割 s1 (`after` / `before`: the panels it was added between). */
  const withAdded = (...adds: [string, string | null, string | null, PageBox][]): FlowData => {
    const data = sample();
    adds.forEach(([folder, after, before, box], i) =>
      data.runs.push({
        ...run(folder, 'コマ追加', 'a/s1', ['panel.png'], `2026-01-02 10:0${i}:00`),
        settings: { split: 'a/s1', pixel_box: box, after, before },
      }),
    );
    return data;
  };
  const rowKeys = (data: FlowData) => {
    const flow = visibleFlow(buildGraph(data));
    return flow.trees[0].steps.map(s => s.cells[0].key);
  };

  it('puts each added panel right after the panel it was added after (null: at the top)', () => {
    const data = withAdded(
      ['a1', 'a/s1/01.png', 'a/s1/02.png', [0, 0, 5, 5]],
      ['a2', null, 'a/s1/01.png', [0, 0, 5, 5]],
      ['a3', 'a/s1/01.png', 'a/a1/panel.png', [0, 0, 5, 5]],
      ['a4', 'a/a1/panel.png', 'a/s1/02.png', [0, 0, 5, 5]],
      ['a5', 'a/s1/02.png', null, [0, 0, 5, 5]],
    );
    expect(rowKeys(data)).toEqual([
      'a/a2/panel.png',
      'a/s1/01.png',
      'a/a3/panel.png',
      'a/a1/panel.png',
      'a/a4/panel.png',
      'a/s1/02.png',
      'a/a5/panel.png',
    ]);
    expect(panelOrder(buildGraph(data), buildGraph(data).runs.get('a/s1')!).length).toBe(7);
  });

  it('falls back to the panel it was added before, then the bottom, when that panel is gone', () => {
    const data = withAdded(
      ['a1', 'a/gone.png', 'a/s1/02.png', [0, 0, 5, 5]],
      ['a2', 'a/gone.png', 'a/gone2.png', [0, 0, 5, 5]],
    );
    expect(rowKeys(data)).toEqual(['a/s1/01.png', 'a/a1/panel.png', 'a/s1/02.png', 'a/a2/panel.png']);
  });

  it('makes an added panel a row of its own: its run, the page, 「追加時」 with its box', () => {
    const data = withAdded(['a1', 'a/s1/01.png', 'a/s1/02.png', [1, 2, 3, 4]]);
    data.runs.push(run('ap', '着彩', 'a/a1/panel.png', ['c.png'], '2026-01-02 11:00:00'));
    const graph = buildGraph(data);
    const flow = visibleFlow(graph);
    const [first, added, second] = flow.trees[0].steps;
    expect([first.panelIndex, added.panelIndex, second.panelIndex]).toEqual([1, 2, 3]);
    expect([first.splitHead, added.splitHead, second.splitHead]).toEqual([true, false, false]);
    expect(added.added).toBe(true);
    expect(added.run?.folder).toBe('a/a1');
    expect(hiddenPage(added)).toBe('a/page.png');
    expect(added.cells.map(c => c.key)).toEqual(['a/a1/panel.png', 'a/ap/c.png']);
    // Not a candidate (★), not a step of its own, no edge from the コマ分割.
    expect(adoptableStack(graph, added.run)).toBeNull();
    expect(flow.steps.has('a/s1|コマ追加')).toBe(false);
    expect(flow.edges.some(e => e.to === added.id)).toBe(false);
    const { versions } = panelVersions(graph, img('a/a1/panel.png'));
    expect(versions.map(v => [v.label, v.box])).toEqual([['追加時', [1, 2, 3, 4]]]);
    expect(versionOf(graph, 'a/ap/c.png')).toBe('a/a1/panel.png');
    expect(panelOf(graph, 'a/ap/c.png')).toBe('a/a1/panel.png');
    expect(upstreamRun(graph, 'a/ap/c.png', 'コマ分割')?.folder).toBe('a/s1');
  });

  it('merges an added panel at its box (its marked image, or its re-cut at the re-cut box)', () => {
    const data = withAdded(['a1', 'a/s1/01.png', 'a/s1/02.png', [1, 2, 3, 4]]);
    data.runs.push(run('ap', '着彩', 'a/a1/panel.png', ['c.png'], '2026-01-02 11:00:00'));
    const graph = buildGraph(data);
    const split = graph.runs.get('a/s1')!;
    expect(mergeExtras(graph, split)).toEqual([{ key: 'a/a1/panel.png', box: [1, 2, 3, 4] }]);
    graph.merge['a/a1/panel.png'] = 'a/ap/c.png';
    expect(mergeExtras(graph, split)).toEqual([{ key: 'a/ap/c.png', box: [1, 2, 3, 4] }]);
    // Not part of the panels of panels.json.
    expect(mergeOverrides(graph, split)).toEqual({});
    data.runs.push({
      ...run('rc', 'コマ切り直し', 'a/a1/panel.png', ['panel.png'], '2026-01-02 12:00:00'),
      settings: { pixel_box: [5, 6, 7, 8] },
    });
    expect(mergeExtras(buildGraph(data), split)).toEqual([{ key: 'a/rc/panel.png', box: [5, 6, 7, 8] }]);
  });

  it('is deleted with its コマ分割, and alone with its own row', () => {
    const graph = buildGraph(withAdded(['a1', 'a/s1/01.png', 'a/s1/02.png', [1, 2, 3, 4]]));
    expect(cascadeRuns(graph, ['a/s1'])).toContain('a/a1');
    expect(planDeletion(graph, ['a/a1/panel.png']).runs).toEqual(['a/a1']);
  });

  it('puts a ＋ on the line above each panel row and below the last', () => {
    const flow = visibleFlow(buildGraph(withAdded(['a1', 'a/s1/01.png', 'a/s1/02.png', [1, 2, 3, 4]])));
    const layout = layoutFlow(flow);
    const gaps = panelGaps(flow, layout);
    expect(gaps.map(g => [g.after?.panelIndex ?? null, g.before?.panelIndex ?? null])).toEqual([
      [null, 1],
      [1, 2],
      [2, 3],
      [3, null],
    ]);
    const [r1, r2] = layout.rows;
    expect(gaps[0].y).toBe(r1.y - LAYOUT.rowGap / 2);
    expect(gaps[1].y).toBe(r2.y - LAYOUT.rowGap / 2);
    expect(gaps[1].y).toBe(r1.y + r1.h + LAYOUT.rowGap / 2);
    expect(gaps[0].x).toBe(LAYOUT.margin + LAYOUT.gutter + LAYOUT.padding + LAYOUT.cellWidth / 2);
    expect(
      panelGaps(
        visibleFlow(buildGraph({ ...sample(), runs: [] })),
        layoutFlow(visibleFlow(buildGraph({ ...sample(), runs: [] }))),
      ),
    ).toEqual([]);
  });
});

describe('newPanelBox', () => {
  it('averages the panels above and below (position and size)', () => {
    expect(newPanelBox([0, 0, 100, 100], [100, 200, 300, 300], 1000)).toEqual([50, 100, 200, 200]);
  });

  it('puts it right below the last panel / above the first one at the same size, kept on the page', () => {
    expect(newPanelBox([10, 20, 110, 70], null, 1000)).toEqual([10, 70, 110, 120]);
    expect(newPanelBox(null, [10, 120, 110, 170], 1000)).toEqual([10, 70, 110, 120]);
    expect(newPanelBox([10, 900, 110, 980], null, 1000)).toEqual([10, 920, 110, 1000]);
    expect(newPanelBox(null, [10, 20, 110, 70], 1000)).toEqual([10, 0, 110, 50]);
    expect(newPanelBox(null, null, 1000)).toBeNull();
  });
});

describe('finalImages', () => {
  it("is each panel row's 「最終」 image (the marked one, else the panel), top to bottom", () => {
    const graph = buildGraph(sample());
    const rows = visibleFlow(graph).trees[0].steps;
    expect(finalImages(graph, rows)).toEqual(['a/s1/01.png', 'a/s1/02.png']);
    graph.merge['a/s1/01.png'] = 'a/p1/p.png';
    expect(finalImages(graph, rows)).toEqual(['a/p1/p.png', 'a/s1/02.png']);
    expect(finalImages(graph, [])).toEqual([]);
  });
});
