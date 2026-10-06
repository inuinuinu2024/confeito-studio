/**
 * FlowCanvas — the Normal mode main area (docs/specs/flow-canvas.md): the processing flow of one archive as
 * boxes ("steps") of image cells joined by edges, laid out automatically from left to right.
 *
 * - Toolbar (top left): the archive shown (newest first; remembered in the settings), refresh, delete the
 *   selection and undo the last deletion (Ctrl+Z).
 * - Selecting: a click on a cell's frame / caption selects it (Ctrl toggles, Shift adds), on a step's
 *   header all its cells; Shift + drag on the background selects a rectangle; a click on the background or
 *   Esc clears. The selection (DocumentManager) is what the tools run on, one image after another.
 * - A click on a thumbnail opens the image in the viewer (shared/ui/image-viewer.ts).
 * - Images generated from an image as 原画 join its box, to its right. Re-runs of a tool on the same image are
 *   side by side in one box: ★ adopts one (saved in the archive) and only its downstream flow is drawn.
 *   Re-runs with several outputs (コマ分割) switch with ‹ ›.
 * - A page split into panels is not shown in the flow: each panel starts its own row at the left. The page is in
 *   the left pane (元ページ) and its コマ結合 results in the right pane (コマ結合後, side-pane.ts); both collapse.
 *   A page not split yet has a 「コマ分割」 button right of it.
 * - 「結合」 on a generated image made from a panel marks what コマ結合 pastes for that panel (else the 原画;
 *   saved in the archive).
 * - Delete removes the selected results and what was made from them (deletion.ts; Ctrl+Z undoes).
 * - Drag on the background pans, Ctrl + wheel zooms, the wheel scrolls; image files dropped here are imported.
 *
 * Inputs (events): archives:changed, archives:location-changed, tool:start, tool:target, normal-mode:toggle
 */
import './flow-canvas.css';
import {
  fetchArchiveKey,
  getArchives,
  getFlow,
  setFlowMerge,
  setFlowSelection,
  splitArchiveKey,
} from '../../shared/api/archives';
import { IMAGE_FILE_PATTERN } from '../../shared/config';
import { on, type ToolTargetState } from '../../shared/events';
import { loadSettings, toolSettings } from '../../shared/state/tool-settings';
import { isViewMode } from '../../shared/state/view-mode';
import type { ArchiveEntry } from '../../shared/types/archive';
import type { FlowImage } from '../../shared/types/flow';
import { confirmDialog, openJsonPreview } from '../../shared/ui/dialogs';
import { h, icon, setShown } from '../../shared/ui/dom';
import { openImageViewer } from '../../shared/ui/image-viewer';
import { showError, showToast } from '../../shared/ui/toast';
import { historyManager } from '../../shared/utils/history';
import { runTool, warnIfToolRunning } from '../ai-panel/tool-runner';
import { DocumentManager } from '../document/DocumentManager';
import { importImageTool } from '../tools/image-loader';
import { TOOLS } from '../tools';
import { deleteTargets, deletionTargets } from './deletion';
import {
  adoptableStack,
  buildGraph,
  type FlowGraph,
  type FlowStep,
  hiddenPage,
  mergeChoice,
  pageMerges,
  splitPageOf,
  panelOf,
  planDeletion,
  type RowLabel,
  rowLabels,
  shownRun,
  type VisibleFlow,
  visibleFlow,
} from './flow-graph';
import { boundsOf, edgePath, type FlowLayout, intersects, LAYOUT, type Rect, layoutFlow } from './flow-layout';
import { createPanZoom } from './pan-zoom';
import { createSidePane } from './side-pane';
import { forgetThumbnails, thumbnailUrl } from './thumbnails';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A small arrowhead at the end of each edge (where one process leads to the next). */
function arrowDefs(): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, 'defs');
  const marker = document.createElementNS(SVG_NS, 'marker');
  for (const [k, v] of Object.entries({
    id: 'flow-arrow',
    viewBox: '0 0 8 8',
    refX: '7',
    refY: '4',
    markerWidth: '8',
    markerHeight: '8',
    orient: 'auto',
  })) {
    marker.setAttribute(k, v);
  }
  const head = document.createElementNS(SVG_NS, 'path');
  head.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z');
  head.setAttribute('class', 'flow-edge__arrow');
  marker.append(head);
  defs.append(marker);
  return defs;
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

/** A tool / settings window (they make #app inert) or a dialog is open. */
const isWindowOpen = () =>
  !!document.getElementById('app')?.inert || !!document.querySelector('.cs-modal-overlay--open, dialog[open]');

const sizeText = (image: FlowImage) => (image.width && image.height ? `${image.width} × ${image.height}` : '');
const folderName = (folder: string) => folder.slice(folder.indexOf('/') + 1);

export function createFlowCanvas(): HTMLElement {
  const settings = toolSettings('flowCanvas');
  const docs = DocumentManager.getInstance();

  // ── State ──
  let archives: ArchiveEntry[] = [];
  let archive: string | null = null;
  let graph: FlowGraph | null = null;
  let flow: VisibleFlow | null = null;
  let layout: FlowLayout | null = null;
  /** Selected image keys in selection order. */
  let selected: string[] = [];
  const cellElements = new Map<string, HTMLElement>();
  const targetStates = new Map<string, ToolTargetState>();
  /** Results of the tool run in progress: all of them end up selected. */
  let runResults: string[] | null = null;
  let loadRequest = 0;

  // ── DOM ──
  const archiveSelect = h('select', { class: 'cs-select flow-toolbar__archive', title: '表示するアーカイブ' });
  const refreshIcon = icon('refresh', 16);
  const refreshButton = h('button', { class: 'flow-toolbar__button', title: '最新の状態に更新' }, refreshIcon);
  const deleteButton = h(
    'button',
    { class: 'flow-toolbar__button', title: '選択した結果を削除 (Delete)', disabled: true },
    icon('delete', 16),
  );
  const undoButton = h(
    'button',
    { class: 'flow-toolbar__button', title: '削除を元に戻す (Ctrl+Z)', disabled: true },
    icon('undo', 16),
  );
  const selectionInfo = h('span', { class: 'flow-toolbar__selection' });
  const toolbar = h(
    'div',
    { class: 'flow-toolbar' },
    icon('folder', 16),
    archiveSelect,
    refreshButton,
    deleteButton,
    undoButton,
    selectionInfo,
  );
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('flow-edges');
  const world = h('div', { class: 'flow-world' });
  const band = h('div', { class: 'flow-band' });
  const viewport = h('div', { class: 'flow-viewport' }, world, band);
  const emptyMessage = h('span', { class: 'canvas-empty__message' });
  const emptyHint = h('span', { class: 'canvas-empty__hint' });
  const emptyState = h('div', { class: 'canvas-empty flow-empty' }, icon('image', 48), emptyMessage, emptyHint);
  const panZoom = createPanZoom(viewport, world);
  panZoom.onFitRequest = () => fitAll();
  const center = h('div', { class: 'flow-center' }, viewport, toolbar, panZoom.bar, emptyState);
  // 3 panes when a page is split (docs/specs/flow-canvas.md 「3 枚構成」): 元ページ | the flow | コマ結合後.
  const leftPane = createSidePane({
    side: 'left',
    title: '元ページ',
    empty: '',
    settings,
    onOpen: (image, title) => void openViewer(image, title),
  });
  const rightPane = createSidePane({
    side: 'right',
    title: 'コマ結合後',
    empty: 'まだコマ結合していません。コマを選んで右の「コマ結合」を実行すると、ここに結合後のページが表示されます。',
    settings,
    onOpen: (image, title) => void openViewer(image, title),
  });
  const main = h('main', { class: 'flow-canvas' }, leftPane.el, center, rightPane.el);
  // The step geometry comes from LAYOUT (flow-layout.ts) so the CSS boxes match the computed layout.
  main.style.setProperty('--flow-cell-w', `${LAYOUT.cellWidth}px`);
  main.style.setProperty('--flow-head', `${LAYOUT.headerHeight}px`);
  main.style.setProperty('--flow-pad', `${LAYOUT.padding}px`);
  main.style.setProperty('--flow-cell-h', `${LAYOUT.cellHeight}px`);
  main.style.setProperty('--flow-cell-gap', `${LAYOUT.cellGap}px`);
  main.style.setProperty('--flow-gutter', `${LAYOUT.gutter}px`);
  main.style.setProperty('--flow-row-gap', `${LAYOUT.rowGap}px`);

  // ── Lazy thumbnails: loaded when their cell comes into view ──
  const thumbnailObserver = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target as HTMLImageElement;
        thumbnailObserver.unobserve(img);
        const key = img.dataset.key;
        if (!key) continue;
        void thumbnailUrl(key).then(url => {
          if (url) img.src = url;
          else img.closest('.flow-cell')?.classList.add('flow-cell--broken');
        });
      }
    },
    { root: viewport, rootMargin: '200px' },
  );

  // ── Selection ──
  const publishSelection = () => {
    const images = graph ? selected.map(k => graph!.images.get(k)).filter((i): i is FlowImage => !!i) : [];
    docs.setSelection(images);
    for (const [key, el] of cellElements) el.classList.toggle('flow-cell--selected', selected.includes(key));
    selectionInfo.textContent = selected.length ? `${selected.length} 枚を選択中` : '';
    syncActionButtons();
  };

  /** Delete: greyed out with nothing selected or while a deletion / undo runs; undo: with nothing to undo. */
  const syncActionButtons = () => {
    deleteButton.disabled = !selected.length || historyManager.isBusy();
    undoButton.disabled = !historyManager.canUndo();
  };

  const setSelected = (keys: readonly string[]) => {
    selected = [...new Set(keys)].filter(k => cellElements.has(k));
    publishSelection();
  };

  /** Click on a cell / step: plain = only these, Ctrl = toggle, Shift = add. */
  const clickSelect = (keys: string[], e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const allSelected = keys.every(k => selected.includes(k));
      setSelected(allSelected ? selected.filter(k => !keys.includes(k)) : [...selected, ...keys]);
    } else if (e.shiftKey) {
      setSelected([...selected, ...keys]);
    } else {
      setSelected(keys);
    }
  };

  // ── Rendering ──
  const applyTargetState = (key: string) => {
    const el = cellElements.get(key);
    const state = targetStates.get(key);
    el?.classList.toggle('flow-cell--running', state === 'running');
    el?.classList.toggle('flow-cell--failed', state === 'failed');
  };

  const renderCell = (image: FlowImage, step: FlowStep, index: number, label: RowLabel | null): HTMLElement => {
    const img = h('img', { class: 'flow-cell__img', alt: image.name, draggable: false, dataset: { key: image.key } });
    const thumb = h('div', { class: 'flow-cell__thumb', title: 'クリックで拡大表示' }, img);
    // A generated image in a 原画's box: its name and what it was generated from, above the image.
    const origin =
      label &&
      h(
        'div',
        { class: 'flow-cell__origin', title: `${label.name}: ${label.from}を原画にして生成` },
        h('span', { class: 'flow-cell__origin-name', text: label.name }),
        h('span', { class: 'flow-cell__origin-from', text: `← ${label.from}` }),
      );
    // No caption under the image (a cleaner canvas): the file name and size are in the tooltip.
    const size = sizeText(image);
    const cell = h(
      'div',
      {
        class: `flow-cell${label ? ' flow-cell--labeled' : ''}`,
        title: size ? `${image.name}（${size}）` : image.name,
        dataset: { key: image.key, name: image.name },
      },
      origin,
      thumb,
      h('span', { class: 'flow-cell__badge flow-cell__badge--failed', title: '処理に失敗しました' }, icon('error', 16)),
      h(
        'span',
        { class: 'flow-cell__badge flow-cell__badge--running', title: '処理中' },
        icon('progress_activity', 16),
      ),
    );
    thumbnailObserver.observe(img);
    // ★ on each of several runs of a stack (candidates, or images generated from the same 原画).
    const candidate = step.layout === 'column' ? null : step.cellRuns[index];
    const candidateStack = graph && adoptableStack(graph, candidate);
    if (candidate && candidateStack && graph) {
      const adopted = shownRun(graph, candidateStack) === candidate;
      const stackId = candidateStack.id;
      cell.classList.toggle('flow-cell--adopted', adopted);
      cell.append(
        h(
          'button',
          {
            class: 'flow-cell__adopt',
            title: adopted ? '採用中の候補（この先の処理を表示中）' : 'この候補を採用（この先の処理を表示）',
            onclick: (e: MouseEvent) => {
              e.stopPropagation();
              if (!adopted) void showRun(stackId, candidate.folder);
            },
          },
          icon('star', 16),
        ),
      );
    }
    const merge = origin && mergeMark(image, cell);
    if (origin && merge) origin.append(merge);
    cell.addEventListener('click', e => {
      e.stopPropagation();
      const onThumb = !!(e.target as HTMLElement).closest('.flow-cell__thumb');
      const where = `${step.cellRuns[index]?.tool ?? '開始画像'}${label ? `（${label.name}）` : ''}`;
      if (onThumb && !e.ctrlKey && !e.metaKey && !e.shiftKey) void openViewer(image, where);
      else clickSelect([image.key], e);
    });
    cellElements.set(image.key, cell);
    return cell;
  };

  const variantSwitcher = (step: FlowStep): HTMLElement | null => {
    const stack = step.stack;
    if (!stack || !step.run || stack.runs.length < 2 || step.layout === 'candidates') return null;
    if (step.panelIndex && step.panelIndex > 1) return null;
    const index = stack.runs.indexOf(step.run);
    const go = (delta: number) => (e: MouseEvent) => {
      e.stopPropagation();
      const next = stack.runs[(index + delta + stack.runs.length) % stack.runs.length];
      void showRun(stack.id, next.folder);
    };
    return h(
      'div',
      { class: 'flow-step__variants', title: `同じ画像に同じツールを ${stack.runs.length} 回実行した結果` },
      h('button', { class: 'flow-step__variant-btn', title: '前の候補', onclick: go(-1) }, icon('chevron_left', 16)),
      h('span', { class: 'flow-step__variant-label', text: `${index + 1}/${stack.runs.length}` }),
      h('button', { class: 'flow-step__variant-btn', title: '次の候補', onclick: go(1) }, icon('chevron_right', 16)),
    );
  };

  /**
   * 「結合」 at the right end of the label of a generated image made from a panel: marks it as what コマ結合
   * pastes for that panel (one per panel; a click on the marked one removes the mark: the 原画 is pasted).
   * Gray while not marked. The 原画 (the panel itself) has none: it is used when nothing is marked.
   */
  const mergeMark = (image: FlowImage, cell: HTMLElement): HTMLElement | null => {
    const panelKey = graph && panelOf(graph, image.key);
    const panel = panelKey ? graph?.images.get(panelKey) : undefined;
    if (!graph || !panelKey || !panel || panelKey === image.key) return null;
    const marked = mergeChoice(graph, panel).key === image.key;
    cell.classList.toggle('flow-cell--merge-marked', marked);
    return h(
      'button',
      {
        class: `flow-cell__merge${marked ? ' flow-cell__merge--marked' : ''}`,
        title: marked
          ? `コマ結合で「${panel.name}」のコマにこの画像を使う（クリックで外すと原画を使う）`
          : `コマ結合で「${panel.name}」のコマにこの画像を使う`,
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          void setMergeChoice(panelKey, marked ? null : image.key);
        },
      },
      icon('merge', 13),
      '結合',
    );
  };

  /** Marks `image` for コマ結合 of `panel` (null removes the mark; saved in the archive). */
  const setMergeChoice = async (panel: string, image: string | null) => {
    if (!graph || !archive) return;
    if (image) graph.merge[panel] = image;
    else delete graph.merge[panel];
    render();
    setSelected(selected);
    try {
      await setFlowMerge(archive, panel, image);
    } catch (err) {
      showError('コマ結合に使う画像の指定を保存できませんでした', err);
    }
  };

  const stepTitle = (step: FlowStep) => {
    if (!step.run) return '開始画像';
    if (step.panelIndex) return `コマ #${step.panelIndex}`;
    if (step.layout === 'candidates') return `${step.run.tool}（${step.cells.length} 件）`;
    return step.run.tool;
  };

  /** The 「コマ分割」 button right of a page that is not split yet: runs コマ分割 on it with the saved settings. */
  const renderAction = (step: FlowStep, rect: Rect): HTMLElement =>
    h(
      'div',
      {
        class: 'flow-step flow-step--action',
        dataset: { step: step.id },
        style: { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` },
      },
      h(
        'button',
        {
          class: 'flow-action__btn',
          title: 'このページをコマ分割する（コマ分割ツールの保存済みの設定で実行）',
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            if (step.splitPage) void splitPage(step.splitPage);
          },
        },
        icon('content_cut', 16),
        h('span', { class: 'flow-step__title', text: 'コマ分割' }),
      ),
    );

  /** Runs コマ分割 on `page` like the tool's ▶ (settings read again, the page selected). */
  const splitPage = async (page: string) => {
    const splitter = TOOLS.find(t => t.id === 'panel-splitter');
    if (!splitter || warnIfToolRunning(splitter.name)) return;
    setSelected([page]);
    await loadSettings();
    await splitter.beforeOpen?.();
    await runTool(splitter);
  };

  /**
   * Title, size of the (first) image, ‹ › and ⋯ of a step: above its images, or as the row label for the step
   * that starts a row. A click selects the step's images.
   */
  const stepHeading = (step: FlowStep, className: string): HTMLElement => {
    const size =
      step.layout === 'candidates' || (step.layout === 'column' && step.cells.length > 1)
        ? ''
        : sizeText(step.cells[0]);
    const menuButton = h('button', { class: 'flow-step__menu', title: 'メニュー' }, icon('more_horiz', 18));
    menuButton.addEventListener('click', e => {
      e.stopPropagation();
      openStepMenu(step, menuButton);
    });
    const heading = h(
      'div',
      { class: className, title: step.run ? `${step.run.created_at}　${folderName(step.run.folder)}` : '' },
      h('span', { class: 'flow-step__title', text: stepTitle(step) }),
      size ? h('span', { class: 'flow-step__size', text: size }) : null,
      variantSwitcher(step),
      menuButton,
    );
    heading.addEventListener('click', e => {
      e.stopPropagation();
      clickSelect(
        step.cells.map(c => c.key),
        e,
      );
    });
    return heading;
  };

  /** A row: its label on the left (the heading of the step that starts it) and a line below it. */
  const renderRow = (row: { id: string; y: number; h: number }, index: number): HTMLElement | null => {
    const step = flow?.steps.get(row.id);
    if (!step || !layout) return null;
    return h(
      'div',
      {
        class: `flow-row${index === 0 ? ' flow-row--first' : ''}`,
        dataset: { step: step.id },
        style: {
          top: `${row.y - LAYOUT.rowGap / 2}px`,
          height: `${row.h + LAYOUT.rowGap}px`,
          width: `${layout.width}px`,
        },
      },
      stepHeading(step, 'flow-row__label'),
    );
  };

  const renderStep = (step: FlowStep, rect: Rect): HTMLElement => {
    if (step.layout === 'action') return renderAction(step, rect);
    const labels = rowLabels(step);
    // The step that starts a row has its heading as the row label; the others above their images.
    const head = step.rowHead ? null : stepHeading(step, 'flow-step__head');
    const classes = [
      'flow-step',
      step.layout !== 'column' && 'flow-step--across',
      step.rowHead && 'flow-step--rowhead',
      !step.run && 'flow-step--root',
    ];
    return h(
      'div',
      {
        class: classes.filter(Boolean).join(' '),
        dataset: { step: step.id },
        style: { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` },
      },
      head,
      h('div', { class: 'flow-step__cells' }, ...step.cells.map((cell, i) => renderCell(cell, step, i, labels[i]))),
    );
  };

  const renderEdges = () => {
    svg.replaceChildren(arrowDefs());
    if (!flow || !layout) return;
    svg.setAttribute('width', String(layout.width));
    svg.setAttribute('height', String(layout.height));
    for (const edge of flow.edges) {
      const from = layout.cells.get(edge.from);
      const step = flow.steps.get(edge.to);
      const to = layout.steps.get(edge.to);
      const firstCell = step && layout.cells.get(step.cells[0]?.key ?? '');
      if (!from || !to) continue;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', edgePath(from, to, firstCell ? firstCell.y + firstCell.h / 2 : to.y + to.h / 2));
      path.setAttribute('class', 'flow-edge');
      path.setAttribute('marker-end', 'url(#flow-arrow)');
      svg.append(path);
    }
  };

  const render = () => {
    for (const img of world.querySelectorAll('img')) thumbnailObserver.unobserve(img);
    cellElements.clear();
    flow = graph ? visibleFlow(graph) : null;
    layout = flow ? layoutFlow(flow) : null;
    const steps = flow && layout ? [...flow.steps.values()].map(s => renderStep(s, layout!.steps.get(s.id)!)) : [];
    const rows = layout ? layout.rows.map(renderRow) : [];
    renderEdges();
    world.replaceChildren(...rows.filter((r): r is HTMLElement => !!r), svg, ...steps);
    world.style.width = `${layout?.width ?? 0}px`;
    world.style.height = `${layout?.height ?? 0}px`;
    for (const key of cellElements.keys()) applyTargetState(key);
    const split = graph && splitPageOf(graph);
    leftPane.show(split ? [split.page] : null);
    rightPane.show(graph && split ? pageMerges(graph, split.split) : null);
    updateEmptyState();
  };

  const updateEmptyState = () => {
    const nothing = !archives.length;
    const empty = !nothing && graph !== null && cellElements.size === 0;
    emptyMessage.textContent = nothing ? '画像を読み込んでください' : empty ? 'このアーカイブには画像がありません' : '';
    emptyHint.textContent = nothing ? '右の「画像読み込み」を実行するか、画像ファイルをここにドロップしてください' : '';
    setShown(emptyState, nothing || empty, 'flex');
    setShown(toolbar, !nothing, 'flex');
  };

  const syncArchiveSelect = () => {
    archiveSelect.replaceChildren(
      ...archives.map(a => h('option', { value: a.key, text: a.name, selected: a.key === archive })),
    );
  };

  // ── Loading ──
  const refreshArchives = async () => {
    archives = await getArchives();
  };

  /**
   * Shows `name` (null: nothing). `select` replaces the selection (else the selection is kept where it
   * still exists); `fit` fits the flow into view, otherwise the view stays and the selection is revealed.
   */
  const load = async (name: string | null, opts: { select?: string[]; fit?: boolean } = {}) => {
    const request = ++loadRequest;
    let data = null;
    if (name) {
      try {
        data = await getFlow(name);
      } catch (err) {
        if (request === loadRequest) showError(`アーカイブ「${name}」を読み込めませんでした`, err);
      }
    }
    if (request !== loadRequest) return;
    const switched = name !== archive;
    archive = data ? name : null;
    docs.setFlow(archive, data);
    graph = data ? buildGraph(data) : null;
    if (graph && archive && opts.select?.length) adoptNewResults(graph, archive, opts.select);
    if (switched && archive && settings.get('archive', '') !== archive) {
      settings.set('archive', archive);
      void settings.save();
    }
    syncArchiveSelect();
    render();
    setSelected(opts.select ?? (switched ? [] : selected));
    if (opts.fit || switched) fitAll();
    else revealSelection();
  };

  /** A new result is the adopted candidate of its stack, even when another one was adopted before. */
  const adoptNewResults = (g: FlowGraph, name: string, keys: readonly string[]) => {
    for (const key of keys) {
      const run = g.runOfImage.get(key);
      const stackId = run && g.stackOfRun.get(run.folder);
      const stack = stackId ? g.stacks.get(stackId) : undefined;
      if (!run || !stackId || !stack || !g.selection[stackId] || shownRun(g, stack) === run) continue;
      g.selection[stackId] = run.folder;
      void setFlowSelection(name, stackId, run.folder).catch(err =>
        showError('表示する候補を保存できませんでした', err),
      );
    }
  };

  let pendingFit = false;
  const fitAll = () => {
    pendingFit = !viewport.clientWidth;
    // From the left edge of the flow: the row labels are part of it.
    const bounds = layout ? boundsOf(layout.steps.values()) : null;
    if (!pendingFit) panZoom.fit(bounds && { ...bounds, x: 0, w: bounds.x + bounds.w });
  };

  const revealSelection = () => {
    const rect = layout && boundsOf(selected.map(k => layout!.cells.get(k)).filter((r): r is Rect => !!r));
    if (rect) panZoom.reveal(rect);
  };

  /** Reloads the archive list and shows `wanted` (or the current / newest archive when it is gone). */
  const reload = async (wanted: string | null, opts: { select?: string[]; fit?: boolean } = {}) => {
    await refreshArchives();
    const exists = (n: string | null) => !!n && archives.some(a => a.key === n);
    const name = exists(wanted) ? wanted : exists(archive) ? archive : (archives[0]?.key ?? null);
    await load(name, opts);
  };

  /** Picks the run shown for a stack (saved in the archive). */
  const showRun = async (stackId: string, folder: string) => {
    if (!graph || !archive) return;
    graph.selection[stackId] = folder;
    render();
    setSelected(selected);
    try {
      await setFlowSelection(archive, stackId, folder);
    } catch (err) {
      showError('表示する候補を保存できませんでした', err);
    }
  };

  // ── Viewer, menu, deletion ──
  const openViewer = async (image: FlowImage, where: string) => {
    const blob = await fetchArchiveKey(image.key);
    if (!blob) {
      showError(`「${image.name}」を読み込めませんでした`);
      return;
    }
    const url = URL.createObjectURL(blob);
    openImageViewer(url, `${where} — ${image.name}`, {
      subtitle: image.width && image.height ? `${image.width} × ${image.height} px` : undefined,
      onClose: () => URL.revokeObjectURL(url),
    });
  };

  let closeMenu: (() => void) | null = null;
  const openStepMenu = (step: FlowStep, anchor: HTMLElement) => {
    closeMenu?.();
    const item = (label: string, iconName: string, action: () => void, disabled = false) =>
      h(
        'button',
        {
          class: 'flow-menu__item',
          disabled,
          onclick: (e: MouseEvent) => {
            e.stopPropagation();
            closeMenu?.();
            action();
          },
        },
        icon(iconName, 16),
        label,
      );
    const run = step.run;
    const page = hiddenPage(step);
    const deleteLabel = !run
      ? 'この画像を削除'
      : step.panelIndex
        ? 'このコマ分割を削除'
        : step.layout === 'candidates'
          ? 'すべての候補を削除'
          : 'この結果を削除';
    const pageImage = page ? graph?.images.get(page) : undefined;
    const menu = h(
      'div',
      { class: 'flow-menu', attrs: { role: 'menu' } },
      item('情報を見る', 'info', () => void showInfo(step), !run),
      item(deleteLabel, 'delete', () => void deleteKeys(step.cells.map(c => c.key))),
      pageImage ? item('元のページごと削除', 'delete_forever', () => void deleteKeys([pageImage.key])) : null,
    );
    const r = anchor.getBoundingClientRect();
    const host = main.getBoundingClientRect();
    menu.style.left = `${r.right - host.left}px`;
    menu.style.top = `${r.bottom - host.top + 4}px`;
    main.append(menu);
    const onDown = (e: Event) => {
      if (!menu.contains(e.target as Node)) closeMenu?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu?.();
    };
    closeMenu = () => {
      menu.remove();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      closeMenu = null;
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
  };

  const showInfo = async (step: FlowStep) => {
    if (!step.run) return;
    const blob = await fetchArchiveKey(`${step.run.folder}/info.json`);
    if (!blob) {
      openJsonPreview(step.run, `${step.run.tool} — ${folderName(step.run.folder)}`);
      return;
    }
    try {
      openJsonPreview(JSON.parse(await blob.text()), `${step.run.tool} — info.json`);
    } catch {
      openJsonPreview(await blob.text(), `${step.run.tool} — info.json`);
    }
  };

  /** Deletes the selected images' results (or pages) and everything made from them, after asking. */
  const deleteSelection = () => deleteKeys(selected);

  /** Deletes the results of `keys` (or the pages) and everything made from them, after asking. */
  const deleteKeys = async (keys: readonly string[]) => {
    if (!graph || !keys.length || historyManager.isBusy()) return;
    const plan = planDeletion(graph, keys);
    const targets = deletionTargets(graph, plan);
    if (!targets.length) return;
    const message = plan.whole
      ? `アーカイブ「${graph.archive}」を削除します（開始画像と結果 ${plan.runs.length} 件）。`
      : [
          `選択した${plan.roots.length ? '画像・' : ''}結果を削除します（${targets.length - plan.downstream} 件）。`,
          plan.downstream ? `この先の結果 ${plan.downstream} 件も一緒に削除されます。` : '',
        ].join('');
    const ok = await confirmDialog({
      title: '削除の確認',
      message: `${message}\nCtrl+Z で元に戻せます（アプリを終了するまで）。`,
      confirmLabel: '削除',
    });
    if (ok) await deleteTargets(targets);
  };

  // ── Pointer: pan, rectangle selection, background click ──
  let gesture: {
    kind: 'pan' | 'band';
    x: number;
    y: number;
    moved: boolean;
    base: string[];
  } | null = null;

  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.flow-step, .flow-row__label')) return;
    closeMenu?.();
    gesture = { kind: e.shiftKey ? 'band' : 'pan', x: e.clientX, y: e.clientY, moved: false, base: [...selected] };
    viewport.setPointerCapture(e.pointerId);
    if (gesture.kind === 'pan') viewport.classList.add('flow-viewport--panning');
  });
  viewport.addEventListener('pointermove', e => {
    if (!gesture) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    gesture.moved = true;
    if (gesture.kind === 'pan') {
      panZoom.panBy(e.movementX, e.movementY);
      return;
    }
    const host = viewport.getBoundingClientRect();
    const left = Math.min(e.clientX, gesture.x) - host.left;
    const top = Math.min(e.clientY, gesture.y) - host.top;
    Object.assign(band.style, {
      display: 'block',
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.abs(dx)}px`,
      height: `${Math.abs(dy)}px`,
    });
    const a = panZoom.toWorld(gesture.x, gesture.y);
    const b = panZoom.toWorld(e.clientX, e.clientY);
    const area = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    const inside = layout ? [...layout.cells].filter(([, r]) => intersects(area, r)).map(([k]) => k) : [];
    setSelected([...gesture.base, ...inside]);
  });
  const endGesture = () => {
    if (gesture && !gesture.moved && gesture.kind === 'pan') setSelected([]);
    gesture = null;
    band.style.display = 'none';
    viewport.classList.remove('flow-viewport--panning');
  };
  viewport.addEventListener('pointerup', endGesture);
  viewport.addEventListener('pointercancel', endGesture);

  viewport.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = viewport.getBoundingClientRect();
        panZoom.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
      } else if (e.shiftKey) {
        panZoom.panBy(-(e.deltaY || e.deltaX), 0);
      } else {
        panZoom.panBy(-e.deltaX, -e.deltaY);
      }
    },
    { passive: false },
  );

  window.addEventListener('keydown', e => {
    if (!isViewMode('normal') || isEditable(e.target) || isWindowOpen()) return;
    if (e.key === 'Escape' && selected.length) {
      setSelected([]);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
      e.preventDefault();
      void deleteSelection();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && cellElements.size) {
      e.preventDefault();
      setSelected([...cellElements.keys()]);
    }
  });

  // ── Drop: import image files ──
  main.addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  main.addEventListener('drop', async e => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/') || IMAGE_FILE_PATTERN.test(file.name)) await runTool(importImageTool(file));
    else showToast('画像ファイル（PNG/JPG/WebP/BMP/GIF）をドロップしてください', 'warning');
  });

  // ── Toolbar ──
  archiveSelect.addEventListener('change', () => void load(archiveSelect.value, { fit: true }));
  refreshButton.addEventListener('click', async () => {
    if (refreshButton.disabled) return;
    refreshButton.disabled = true;
    refreshIcon.classList.add('is-spinning');
    try {
      forgetThumbnails();
      await reload(archive);
      showToast('最新の状態に更新しました', 'success');
    } finally {
      refreshIcon.classList.remove('is-spinning');
      refreshButton.disabled = false;
    }
  });

  deleteButton.addEventListener('click', () => void deleteSelection());
  undoButton.addEventListener('click', () => void historyManager.undo());
  on('history:changed', syncActionButtons);

  // ── Events ──
  on('archives:changed', detail => {
    let select = detail?.select;
    if (runResults && select) {
      // A run of several images: keep selecting every result made so far.
      runResults.push(...select);
      select = [...runResults];
    }
    const wanted = detail?.archive ?? (select?.length ? splitArchiveKey(select[0])[0] : archive);
    void reload(wanted, { select });
  });
  on('archives:location-changed', () => {
    forgetThumbnails();
    historyManager.clear();
    selected = [];
    void reload(null, { fit: true });
  });
  on('tool:start', () => {
    runResults = [];
    for (const [key, state] of targetStates) if (state === 'failed') targetStates.delete(key);
    for (const key of cellElements.keys()) applyTargetState(key);
  });
  on('tool:end', () => {
    runResults = null;
    for (const [key, state] of targetStates) if (state !== 'failed') targetStates.delete(key);
    for (const key of cellElements.keys()) applyTargetState(key);
  });
  on('tool:target', ({ key, state }) => {
    if (state === 'done') targetStates.delete(key);
    else targetStates.set(key, state);
    applyTargetState(key);
  });
  // An archive loaded while the canvas was hidden (another mode) is fitted when it is shown.
  on('normal-mode:toggle', ({ enabled }) => {
    if (enabled && pendingFit) fitAll();
  });

  void (async () => {
    await refreshArchives();
    const saved = settings.get('archive', '');
    await reload(saved || null, { fit: true });
  })();
  updateEmptyState();
  return main;
}
