/**
 * FlowCanvas — the Normal mode main area (docs/specs/flow-canvas.md): the processing flow of one archive as
 * boxes ("steps") of image cells joined by edges, laid out automatically from left to right.
 *
 * - Toolbar (top left): the archive shown (newest first; remembered in the settings), refresh, delete the
 *   selection and undo the last deletion (Ctrl+Z).
 * - Selecting: a click on a cell's frame / caption selects it (Ctrl toggles, Shift adds), on a step's
 *   header all its cells; Shift + drag on the background selects a rectangle; a click on the background or
 *   Esc clears. The selection (DocumentManager) is what the tools run on, one image after another.
 * - A click on a thumbnail opens the image in the viewer (shared/ui/image-viewer.ts); on the 原画 of a panel's row
 *   it opens the panel cropper instead (panel-cropper.ts): where the panel was cut from the page, cutting it again
 *   (a new version of the panel, shown in its row) and picking an earlier version back. On an image generated from
 *   a 原画 it opens the comparison window with the first image of its flow instead (canvas/compare-window.ts).
 * - Images generated from an image as 原画 join its box, to its right. Re-runs of a tool on the same image are
 *   side by side in one box: ★ adopts one (saved in the archive) and only its downstream flow is drawn.
 *   Re-runs with several outputs (コマ分割) switch with ‹ ›.
 * - A page split into panels is not shown in the flow: each panel starts its own row at the left. The page is in
 *   the left pane (元ページ) and its コマ結合 results in the right pane (コマ結合後, side-pane.ts); both collapse.
 *   A page not split yet has a 「コマ分割」 button right of it.
 * - 「最終」 on a generated image made from a panel marks what コマ結合 pastes for that panel (else the 原画;
 *   saved in the archive).
 * - Delete removes the selected results and what was made from them (deletion.ts; Ctrl+Z undoes).
 * - At the right end of a panel row: the AI画像生成 and 背景除去 buttons of the TOOLS list (open the window / ▶ / ⏸),
 *   for the row's rightmost image (it is selected first). In the 全コマ row above the panel rows, the same buttons for
 *   every panel: AI画像生成, 背景除去 (every row's rightmost image, one after another) and コマ結合 (every panel).
 * - ＋ on the lines between the panel rows (and above the first / below the last) adds a panel: the panel cropper in
 *   add mode, the frame starting between the panels around it (コマ追加, saved as a result of its own).
 * - Always at 100% from the top left (no zoom, no dragging the view): scroll bars when the flow does not fit; image
 *   files dropped here are imported.
 *
 * Inputs (events): archives:changed, archives:location-changed, tool:start, tool:end, tool:target
 */
import './flow-canvas.css';
import {
  createArchive,
  fetchArchiveKey,
  getArchives,
  getFlow,
  setFlowMerge,
  setFlowSelection,
  splitArchiveKey,
} from '../../shared/api/archives';
import { addPanel, recropPanel } from '../../shared/api/image';
import { IMAGE_FILE_PATTERN } from '../../shared/config';
import { on, type ToolTargetState } from '../../shared/events';
import { loadSettings, toolSettings } from '../../shared/state/tool-settings';
import { isViewMode } from '../../shared/state/view-mode';
import type { ArchiveEntry } from '../../shared/types/archive';
import type { FlowImage } from '../../shared/types/flow';
import { confirmDialog, inputDialog, openJsonPreview } from '../../shared/ui/dialogs';
import { h, icon, setShown } from '../../shared/ui/dom';
import { openImageViewer } from '../../shared/ui/image-viewer';
import { showError, showToast } from '../../shared/ui/toast';
import { describeError } from '../../shared/utils/error-message';
import { historyManager } from '../../shared/utils/history';
import { createToolButton, type ToolButton } from '../ai-panel/components/ToolButton';
import { openTool, playTool } from '../ai-panel/tool-launch';
import { runningToolName, runTool, warnIfToolRunning } from '../ai-panel/tool-runner';
import { openCompareWindow } from '../canvas/compare-window';
import { DocumentManager } from '../document/DocumentManager';
import { importImageTool } from '../tools/image-loader';
import { TOOLS } from '../tools';
import { deleteTargets, deletionTargets } from './deletion';
import { downloadImages } from './export-images';
import {
  ADD_TOOL,
  adoptableStack,
  buildGraph,
  compareTargets,
  finalImages,
  type FlowGraph,
  type FlowStep,
  hiddenPage,
  joinsRow,
  mergeChoice,
  newPanelBox,
  type PageBox,
  rowFinal,
  splitPageOf,
  panelOf,
  panelVersions,
  planDeletion,
  RECROP_TOOL,
  type RowLabel,
  rowLabels,
  shownRun,
  shownVersion,
  stackIdOf,
  versionOf,
  type VisibleFlow,
  visibleFlow,
} from './flow-graph';
import {
  edgePath,
  type FlowLayout,
  intersects,
  LAYOUT,
  type PanelGap,
  panelGaps,
  type PanelTools,
  type Rect,
  boundsOf,
  layoutFlow,
} from './flow-layout';
import { openPanelCropper, panelBoxOf } from './panel-cropper';
import { createSidePane, type SidePane } from './side-pane';
import { forgetThumbnails, thumbnailUrl } from './thumbnails';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The tools at the right end of a panel row (docs/specs/flow-canvas.md 「コマの行のツール」), top to bottom. */
const ROW_TOOL_IDS = ['nano-banana-pro', 'remove-background'];
/** The tool of the 全コマ row only (docs/specs/flow-canvas.md 「全コマのツール」): コマ結合 of every panel. */
const MERGE_TOOL_ID = 'panel-merge';
const SPLIT_TOOL_ID = 'panel-splitter';
/** Room kept around the selection when it is scrolled into view. */
const REVEAL_MARGIN = 24;

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
  /** The tool buttons of the panel rows shown (▶ / ⏸ follow the running tool). */
  let rowToolButtons: { name: string; button: ToolButton }[] = [];
  /** The buttons of the side panes: the 元ページ's コマ分割 (made once). */
  const paneToolButtons: { name: string; button: ToolButton }[] = [];
  /** The page in the 元ページ pane (not in the flow): コマ分割 of the widened pane runs on it. */
  let pageKey: string | null = null;
  /** Object URLs of the whole images of the 元ページ pane's row (its cells are as high as the pane). */
  const paneUrls = new Map<string, string>();
  const targetStates = new Map<string, ToolTargetState>();
  /** Results of the tool run in progress: all of them end up selected. */
  let runResults: string[] | null = null;
  let loadRequest = 0;

  // ── DOM ──
  const archiveSelect = h('select', { class: 'cs-select flow-toolbar__archive', title: '表示するアーカイブ' });
  const newButton = h('button', { class: 'flow-toolbar__button', title: '新規作成' }, icon('add', 18));
  const importButton = h('button', { class: 'flow-toolbar__button', title: '画像読み込み' }, icon('upload', 18));
  const refreshIcon = icon('refresh', 16);
  const refreshButton = h('button', { class: 'flow-toolbar__button', title: '更新' }, refreshIcon);
  const exportButton = h(
    'button',
    { class: 'flow-toolbar__button', title: '書き出し', disabled: true },
    icon('download', 16),
  );
  const deleteButton = h(
    'button',
    { class: 'flow-toolbar__button', title: '削除（Delete）', disabled: true },
    icon('delete', 16),
  );
  const undoButton = h(
    'button',
    { class: 'flow-toolbar__button', title: '元に戻す（Ctrl+Z）', disabled: true },
    icon('undo', 16),
  );
  const redoButton = h(
    'button',
    { class: 'flow-toolbar__button', title: 'やり直し（Ctrl+Y）', disabled: true },
    icon('redo', 16),
  );
  const selectionInfo = h('span', { class: 'flow-toolbar__selection' });
  const toolbar = h(
    'div',
    { class: 'flow-toolbar' },
    archiveSelect,
    newButton,
    importButton,
    refreshButton,
    exportButton,
    deleteButton,
    undoButton,
    redoButton,
    selectionInfo,
  );
  // The full width of the view, with the boundary line below it.
  const toolbarRow = h('div', { class: 'flow-toolbar-row' }, toolbar);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('flow-edges');
  const world = h('div', { class: 'flow-world' });
  const band = h('div', { class: 'flow-band' });
  // Scrolls (scroll bars) when the flow does not fit; the world is never moved or scaled otherwise.
  const viewport = h('div', { class: 'flow-viewport' }, world);
  const emptyMessage = h('span', { class: 'canvas-empty__message' });
  const emptyHint = h('span', { class: 'canvas-empty__hint' });
  const emptyState = h('div', { class: 'canvas-empty flow-empty' }, icon('image', 48), emptyMessage, emptyHint);
  const center = h('div', { class: 'flow-center' }, viewport, emptyState);
  /** The panel rows shown, top to bottom. */
  const panelRows = () =>
    [...(flow?.steps.values() ?? [])]
      .filter(s => s.panelIndex)
      .sort((a, b) => (a.panelIndex ?? 0) - (b.panelIndex ?? 0));
  /** The 原画 of every panel row (what コマ結合 is run for), top to bottom. */
  const panelOriginals = () => panelRows().flatMap(s => (s.cells[0] ? [s.cells[0].key] : []));
  /**
   * The buttons of `toolIds` for the images `keys()` returns when one is pressed: they are selected first, then the
   * button opens the tool window and ▶ runs it (as in the TOOLS list). `into` collects them for ▶ / ⏸.
   */
  const toolButtons = (
    toolIds: readonly string[],
    keys: () => string[],
    into: { name: string; button: ToolButton }[],
  ): HTMLElement[] =>
    toolIds.flatMap(id => {
      const tool = TOOLS.find(t => t.id === id);
      if (!tool) return [];
      const forImages = (action: () => void) => {
        if (warnIfToolRunning(tool.name)) return;
        const chosen = keys();
        if (!chosen.length) return;
        setSelected(chosen);
        action();
      };
      const button = createToolButton(tool, {
        open: el => forImages(() => void openTool(tool, el)),
        play: () => forImages(() => void playTool(tool)),
      });
      button.setRunning(runningToolName() === tool.name);
      into.push({ name: tool.name, button });
      return [button.el];
    });
  // 3 panes when a page is split (docs/specs/flow-canvas.md 「3 枚構成」): 元ページ | the flow | コマ結合後.
  /** The tools of a widened side pane: `first` (for its own images), then the panel rows' tools for the rightmost image of its row. */
  const sideTools = (first: HTMLElement[], row: () => FlowStep | null | undefined) =>
    h(
      'div',
      { class: 'flow-row-tools flow-tools flow-pane__row-tools' },
      ...first,
      ...toolButtons(
        ROW_TOOL_IDS,
        () => {
          const image = rightmost(row() ?? undefined);
          return image ? [image.key] : [];
        },
        paneToolButtons,
      ),
    );
  // Only one side pane is widened at a time: widening one brings the other back to its open width.
  const leftPane: SidePane = createSidePane({
    side: 'left',
    title: '元ページ',
    empty: '',
    settings,
    onOpen: (image, title) => void openViewer(image, title),
    // コマ分割 of the page.
    tools: sideTools(
      toolButtons([SPLIT_TOOL_ID], () => (pageKey ? [pageKey] : []), paneToolButtons),
      () => flow?.pageRow,
    ),
    onWiden: () => rightPane.narrow(),
  });
  const rightPane: SidePane = createSidePane({
    side: 'right',
    title: 'コマ結合後',
    empty: 'まだコマ結合していません。「全コマ」の行の「コマ結合」を実行すると、ここに結合後のページが表示されます。',
    settings,
    onOpen: (image, title) => void openViewer(image, title),
    // No コマ結合 here: it is in the 全コマ row.
    tools: sideTools([], () => flow?.mergeRow),
    onWiden: () => leftPane.narrow(),
  });
  if (leftPane.wide) rightPane.narrow();
  // A click on a pane's background clears the selection, as on the flow's.
  for (const pane of [leftPane, rightPane]) {
    pane.el.addEventListener('click', e => {
      if (
        !(e.target as HTMLElement).closest(
          '.flow-cell, .flow-pane__cell, button, .flow-pane__edges, .flow-pane__resizer',
        )
      )
        setSelected([]);
    });
  }
  // The toolbar spans the whole view, above the side panes and the flow (not over them), so nothing is hidden under it.
  const main = h(
    'main',
    { class: 'flow-canvas' },
    toolbarRow,
    h('div', { class: 'flow-body' }, leftPane.el, center, rightPane.el),
  );
  // The step geometry comes from LAYOUT (flow-layout.ts) so the CSS boxes match the computed layout.
  main.style.setProperty('--flow-cell-w', `${LAYOUT.cellWidth}px`);
  main.style.setProperty('--flow-head', `${LAYOUT.headerHeight}px`);
  main.style.setProperty('--flow-pad', `${LAYOUT.padding}px`);
  main.style.setProperty('--flow-cell-h', `${LAYOUT.cellHeight}px`);
  main.style.setProperty('--flow-cell-gap', `${LAYOUT.cellGap}px`);
  main.style.setProperty('--flow-origin-gap', `${LAYOUT.originGap}px`);
  main.style.setProperty('--flow-tools-w', `${LAYOUT.toolsWidth}px`);
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
    leftPane.select(selected);
    rightPane.select(selected);
    selectionInfo.textContent = selected.length ? `${selected.length} 枚を選択中` : '';
    syncActionButtons();
  };

  /**
   * Export / delete: greyed out with nothing selected (delete also while a deletion / undo runs);
   * undo: with nothing to undo.
   */
  const syncActionButtons = () => {
    // Without a selection: every panel's 「最終」 image (nothing to export without panel rows).
    exportButton.disabled = !selected.length && !panelRows().length;
    deleteButton.disabled = !selected.length || historyManager.isBusy();
    undoButton.disabled = !historyManager.canUndo();
    redoButton.disabled = !historyManager.canRedo();
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

  /** `whole`: the whole image instead of the thumbnail (the 元ページ pane's cells, as high as the pane). */
  const renderCell = (
    image: FlowImage,
    step: FlowStep,
    index: number,
    label: RowLabel | null,
    whole = false,
  ): HTMLElement => {
    const img = h('img', { class: 'flow-cell__img', alt: image.name, draggable: false, dataset: { key: image.key } });
    // The 原画 of a panel's row opens the panel cropper (where it was cut from the page; cut it again).
    const panelHead = !!step.panel && index === 0;
    const thumb = h(
      'div',
      {
        class: 'flow-cell__thumb',
        title: panelHead ? '切り直し' : '拡大表示',
      },
      img,
    );
    // A generated image in a 原画's box: its name and what it was generated from, above the image.
    const origin =
      label &&
      h(
        'div',
        { class: 'flow-cell__origin', title: `${label.name}: ${label.from}を原画にして生成` },
        h('span', { class: 'flow-cell__origin-name', text: label.name }),
        h('span', { class: 'flow-cell__origin-from', text: `← ${label.from}` }),
      );
    // The 原画 of a box with generated images, and of every panel row: 「原画」 above it, so it is told apart from
    // the generated images (▶ between them).
    const source =
      index === 0 && (step.layout === 'row' || !!step.panel)
        ? h(
            'div',
            { class: 'flow-cell__origin flow-cell__origin--source', title: '原画（右の画像はこの画像から生成）' },
            h('span', { class: 'flow-cell__origin-name', text: '原画' }),
          )
        : null;
    // No caption under the image (a cleaner canvas): the file name and size are in the tooltip.
    const size = sizeText(image);
    const cell = h(
      'div',
      {
        class: `flow-cell${label || source ? ' flow-cell--labeled' : ''}`,
        title: size ? `${image.name}（${size}）` : image.name,
        dataset: { key: image.key, name: image.name },
      },
      origin ?? source,
      thumb,
      h('span', { class: 'flow-cell__badge flow-cell__badge--failed', title: '処理に失敗しました' }, icon('error', 16)),
      h(
        'span',
        { class: 'flow-cell__badge flow-cell__badge--running', title: '処理中' },
        icon('progress_activity', 16),
      ),
    );
    if (whole) {
      loadWhole(img, image.key);
      // As wide as the image at the pane's height, even before it loads (flow-canvas.css).
      if (image.width && image.height) cell.style.setProperty('--flow-aspect', String(image.width / image.height));
    } else thumbnailObserver.observe(img);
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
            title: adopted ? '採用中' : '採用',
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
      // A result in a row is named by its band ("背景除去 1"), others by their tool.
      const where = label?.name ?? step.cellRuns[index]?.tool ?? '開始画像';
      if (onThumb && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        if (panelHead) {
          void openCropper(step).then(opened => {
            if (!opened) void openViewer(image, where);
          });
        } else openImage(step, index, where);
      } else {
        clickSelect([image.key], e);
      }
    });
    cellElements.set(image.key, cell);
    return cell;
  };

  const variantSwitcher = (step: FlowStep): HTMLElement | null => {
    const stack = step.stack;
    if (!stack || !step.run || stack.runs.length < 2 || step.layout === 'candidates') return null;
    // A panel row: only the first panel of the コマ分割 switches between its runs.
    if (step.panelIndex && !step.splitHead) return null;
    const index = stack.runs.indexOf(step.run);
    const go = (delta: number) => (e: MouseEvent) => {
      e.stopPropagation();
      const next = stack.runs[(index + delta + stack.runs.length) % stack.runs.length];
      void showRun(stack.id, next.folder);
    };
    return h(
      'div',
      { class: 'flow-step__variants' },
      h('button', { class: 'flow-step__variant-btn', title: '前の候補', onclick: go(-1) }, icon('chevron_left', 16)),
      h('span', { class: 'flow-step__variant-label', text: `${index + 1}/${stack.runs.length}` }),
      h('button', { class: 'flow-step__variant-btn', title: '次の候補', onclick: go(1) }, icon('chevron_right', 16)),
    );
  };

  /**
   * The 「最終」 mark `image` can take: for the panel it was made from (what コマ結合 pastes for it), or for the split
   * page when it is in the page's row (what the 元ページ pane shows). Null for the 原画 (the panel itself, a re-cut,
   * the page): it is used when nothing is marked.
   */
  const markOf = (image: FlowImage): { owner: string; marked: boolean } | null => {
    if (!graph) return null;
    const row = [flow?.pageRow, flow?.mergeRow].find(r => r?.cells.includes(image));
    if (row) {
      if (row.cells[0] === image) return null;
      return { owner: row.cells[0].key, marked: rowFinal(graph, row).key === image.key };
    }
    const panelKey = panelOf(graph, image.key);
    const panel = panelKey ? graph.images.get(panelKey) : undefined;
    if (!panelKey || !panel || versionOf(graph, image.key) === image.key) return null;
    return { owner: panelKey, marked: mergeChoice(graph, panel).key === image.key };
  };

  /**
   * 「最終」 at the right end of the label of a generated image made from a panel (or from the split page): marks it
   * (one per panel / page; a click on the marked one removes the mark: the 原画 is used). Gray while not marked.
   */
  const mergeMark = (image: FlowImage, cell: HTMLElement): HTMLElement | null => {
    const mark = markOf(image);
    if (!mark) return null;
    const { owner, marked } = mark;
    cell.classList.toggle('flow-cell--merge-marked', marked);
    return h(
      'button',
      {
        class: `flow-cell__merge${marked ? ' flow-cell__merge--marked' : ''}`,
        title: marked ? '最終を外す' : '最終にする',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          void setMergeChoice(owner, marked ? null : image.key);
        },
      },
      '最終',
    );
  };

  /** Marks `image` 「最終」 for `panel` (a panel or the split page; null removes the mark; saved in the archive). */
  const setMergeChoice = async (panel: string, image: string | null) => {
    if (!graph || !archive) return;
    if (image) graph.merge[panel] = image;
    else delete graph.merge[panel];
    render();
    setSelected(selected);
    try {
      await setFlowMerge(archive, panel, image);
    } catch (err) {
      showError('「最終」の指定を保存できませんでした', err);
    }
  };

  const stepTitle = (step: FlowStep) => {
    if (!step.run) return '開始画像';
    if (step.panelIndex) return `コマ ${step.panelIndex}`;
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
    const splitter = TOOLS.find(t => t.id === SPLIT_TOOL_ID);
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
    // A panel row has a labelled 「コマを削除」 below its size (that panel alone); other headings the ⋯ menu.
    const panel = step.panelIndex ? step.panel : undefined;
    const menuButton = panel
      ? h('button', { class: 'flow-row__delete' }, icon('delete', 14), 'コマを削除')
      : h('button', { class: 'flow-step__menu', title: 'メニュー' }, icon('more_horiz', 18));
    menuButton.addEventListener('click', e => {
      e.stopPropagation();
      if (panel) void deleteKeys([panel.key]);
      else openStepMenu(step, menuButton);
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
        },
      },
      stepHeading(step, 'flow-row__label'),
    );
  };

  /** ＋ on the line between two panel rows (or above the first / below the last): adds a panel there. */
  const renderGap = (gap: PanelGap): HTMLElement =>
    h(
      'button',
      {
        class: 'flow-insert',
        title: 'コマを追加',
        dataset: { after: String(gap.after?.panelIndex ?? 0), before: String(gap.before?.panelIndex ?? 0) },
        style: { left: `${gap.x}px`, top: `${gap.y}px` },
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          void openAdder(gap);
        },
      },
      icon('add', 16),
    );

  /** "コマ 1 と 2 の間" / "コマ 1 の前" / "コマ 3 の後" */
  const gapText = (gap: PanelGap) =>
    gap.after && gap.before
      ? `コマ ${gap.after.panelIndex} と ${gap.before.panelIndex} の間`
      : gap.before
        ? `コマ ${gap.before.panelIndex} の前`
        : `コマ ${gap.after?.panelIndex} の後`;

  /** The rightmost image of a panel row (its last cell), the tools of the row run on it. */
  const rightmost = (step: FlowStep | undefined) => step?.cells[step.cells.length - 1];

  /**
   * The AI画像生成 and 背景除去 buttons of the panel rows at the left of their free room (`layout.panelTools`): each
   * row's right after its images, for its rightmost image; the 全コマ header's above the first row, for every row's
   * rightmost image (docs/specs/flow-canvas.md 「コマの行のツール」「全コマのツール」).
   */
  const renderPanelTools = (tools: PanelTools): HTMLElement[] => {
    const place = (x: number, y: number, h: number) => ({ left: `${x}px`, top: `${y}px`, height: `${h}px` });
    const rowTools = tools.rows.map(({ id, x, y }) => {
      const image = rightmost(flow?.steps.get(id));
      return h(
        'div',
        { class: 'flow-row-tools flow-tools', dataset: { step: id }, style: place(x, y, LAYOUT.cellHeight) },
        ...toolButtons(ROW_TOOL_IDS, () => (image ? [image.key] : []), rowToolButtons),
      );
    });
    const everyRow = () =>
      panelRows().flatMap(s => {
        const image = rightmost(s);
        return image ? [image.key] : [];
      });
    const header = [
      h('div', {
        class: 'flow-panels-header__label',
        text: '全コマ',
        style: { top: `${tools.header.y}px`, height: `${tools.header.h}px` },
      }),
      h(
        'div',
        {
          class: 'flow-row-tools flow-tools flow-panels-header',
          style: place(tools.header.x, tools.header.y, tools.header.h),
        },
        ...toolButtons(ROW_TOOL_IDS, everyRow, rowToolButtons),
        // コマ結合 of every panel: only here, not in the コマ結合後 pane.
        ...toolButtons([MERGE_TOOL_ID], panelOriginals, rowToolButtons),
      ),
    ];
    return [...header, ...rowTools];
  };

  const renderStep = (step: FlowStep, rect: Rect): HTMLElement => {
    if (step.layout === 'action') return renderAction(step, rect);
    const labels = rowLabels(step);
    const cells: HTMLElement[] = step.cells.map((cell, i) => renderCell(cell, step, i, labels[i]));
    // ▶ between the 原画 and the images generated from it (LAYOUT.originGap leaves room for it).
    if (step.layout === 'row' && cells.length > 1) {
      cells.splice(
        1,
        0,
        h('span', { class: 'flow-step__origin-arrow', attrs: { 'aria-hidden': 'true' } }, icon('play_arrow', 20)),
      );
    }
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
      h('div', { class: 'flow-step__cells' }, ...cells),
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
    rowToolButtons = [];
    flow = graph ? visibleFlow(graph) : null;
    layout = flow ? layoutFlow(flow) : null;
    // The rows of the side panes (renderSideRows) are not laid out in the flow.
    const steps =
      flow && layout
        ? [...flow.steps.values()].filter(s => !isSideRow(s)).map(s => renderStep(s, layout!.steps.get(s.id)!))
        : [];
    const rows = layout ? layout.rows.map(renderRow) : [];
    const gaps = flow && layout ? panelGaps(flow, layout).map(renderGap) : [];
    renderEdges();
    const panelTools = layout?.panelTools ? renderPanelTools(layout.panelTools) : [];
    world.replaceChildren(...rows.filter((r): r is HTMLElement => !!r), svg, ...steps, ...gaps, ...panelTools, band);
    world.style.width = `${layout?.width ?? 0}px`;
    world.style.height = `${layout?.height ?? 0}px`;
    renderSideRows();
    for (const key of cellElements.keys()) applyTargetState(key);
    updateEmptyState();
  };

  /** A step shown in a side pane (元ページ / コマ結合後), not in the flow. */
  const isSideRow = (step: FlowStep | undefined) => !!step && (step === flow?.pageRow || step === flow?.mergeRow);

  /**
   * The side panes (docs/specs/flow-canvas.md 「3 枚構成」): 元ページ (the page's row) and コマ結合後 (the shown merge's
   * row; shown, empty, with a split page not merged yet). Both hidden without a split page.
   */
  const renderSideRows = () => {
    const split = !!graph && splitPageOf(graph) !== null;
    pageKey = flow?.pageRow?.cells[0].key ?? null;
    // A page not split yet, nothing else in the flow: 元ページ widened over the whole Workspace (no panes, no flow).
    const pageOnly = !split && !!flow?.pageRow && flow.trees.length === 0;
    main.classList.toggle('flow-canvas--page-only', pageOnly);
    leftPane.setFull(pageOnly);
    renderSideRow(leftPane, flow?.pageRow ?? null, !!flow?.pageRow);
    renderSideRow(rightPane, flow?.mergeRow ?? null, split, flow?.mergeRow ? variantSwitcher(flow.mergeRow) : null);
    const kept = new Set([...(flow?.pageRow?.cells ?? []), ...(flow?.mergeRow?.cells ?? [])].map(c => c.key));
    for (const [key, url] of paneUrls) {
      if (kept.has(key)) continue;
      URL.revokeObjectURL(url);
      paneUrls.delete(key);
    }
  };

  /**
   * A side pane: open, the 「最終」 image of its row (else its 原画); widened, the row like a row of the flow (the
   * same cells: bands, ★, 「最終」, selection, comparison), as high as the pane. `extra` under its label (‹ ›).
   */
  const renderSideRow = (pane: SidePane, row: FlowStep | null, shown: boolean, extra: HTMLElement | null = null) => {
    if (!graph || !row) {
      pane.setRow([]);
      pane.show(shown ? null : undefined);
      return;
    }
    const labels = rowLabels(row);
    const cells: HTMLElement[] = row.cells.map((cell, i) => renderCell(cell, row, i, labels[i], true));
    // ▶ between the 原画 and the images made from it, as in the flow.
    if (cells.length > 1) {
      cells.splice(
        1,
        0,
        h('span', { class: 'flow-step__origin-arrow', attrs: { 'aria-hidden': 'true' } }, icon('play_arrow', 20)),
      );
    }
    pane.setRow(cells, extra);
    const final = rowFinal(graph, row);
    const index = row.cells.findIndex(c => c.key === final.key);
    pane.show(row.cells[index], { band: labels[index]?.name ?? '原画', size: row.cells[0] });
  };

  /** The whole image `key` into `img` (kept while it is in the 元ページ pane's row). */
  const loadWhole = (img: HTMLImageElement, key: string) => {
    const known = paneUrls.get(key);
    if (known) {
      img.src = known;
      return;
    }
    void fetchArchiveKey(key).then(blob => {
      if (!blob) {
        img.closest('.flow-cell')?.classList.add('flow-cell--broken');
        return;
      }
      const url = paneUrls.get(key) ?? URL.createObjectURL(blob);
      paneUrls.set(key, url);
      img.src = url;
    });
  };

  const updateEmptyState = () => {
    const nothing = !archives.length;
    const empty = !nothing && graph !== null && cellElements.size === 0;
    emptyMessage.textContent = nothing ? '画像を読み込んでください' : empty ? 'このアーカイブには画像がありません' : '';
    emptyHint.textContent = nothing ? '右の「画像読み込み」を実行するか、画像ファイルをここにドロップしてください' : '';
    setShown(emptyState, nothing || empty, 'flex');
    setShown(toolbarRow, !nothing, 'flex');
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
   * still exists); `fit` shows the flow from its top left, otherwise the view stays and the selection is revealed.
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
    docs.setFlow(archive, data, archives.find(a => a.key === archive)?.name ?? archive);
    graph = data ? buildGraph(data) : null;
    if (graph && archive && opts.select?.length) adoptNewResults(graph, archive, opts.select);
    if (switched && archive && settings.get('archive', '') !== archive) {
      settings.set('archive', archive);
      void settings.save();
    }
    syncArchiveSelect();
    render();
    setSelected(opts.select ?? (switched ? [] : selected));
    if (opts.fit || switched) goHome();
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

  /** Shows the flow from its top left (the row labels at the left edge). */
  const goHome = () => viewport.scrollTo(0, 0);

  /** Scrolls the least so that the selection is in view (the view stays at the left edge when it can). */
  const revealSelection = () => {
    // A new image of a side pane's row: into view in the pane (its row scrolls sideways).
    const inPane = selected.filter(k => isSideRow(flow?.stepOfCell.get(k)));
    cellElements.get(inPane[inPane.length - 1] ?? '')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = layout && boundsOf(selected.map(k => layout!.cells.get(k)).filter((r): r is Rect => !!r));
    if (!rect) return;
    /** The scroll position along one axis that shows [start, start + size) with `REVEAL_MARGIN` around it. */
    const along = (scroll: number, view: number, start: number, size: number) =>
      start - REVEAL_MARGIN < scroll
        ? Math.max(0, start - REVEAL_MARGIN)
        : start + size + REVEAL_MARGIN > scroll + view
          ? Math.min(start - REVEAL_MARGIN, start + size + REVEAL_MARGIN - view)
          : scroll;
    viewport.scrollTo(
      along(viewport.scrollLeft, viewport.clientWidth, rect.x + world.offsetLeft, rect.w),
      along(viewport.scrollTop, viewport.clientHeight, rect.y + world.offsetTop, rect.h),
    );
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

  /**
   * A click on the thumbnail of `step.cells[index]`: an image generated from a 原画 is compared with the first image
   * of its flow, or another image generated in the step, in the comparison window (docs/specs/flow-canvas.md
   * 「原画との比較」); any other image opens in the viewer.
   */
  const openImage = (step: FlowStep, index: number, where: string) => {
    const image = step.cells[index];
    const run = step.cellRuns[index];
    const targets = graph && run && joinsRow(run) ? compareTargets(graph, step, index) : [];
    if (!targets.length) {
      void openViewer(image, where);
      return;
    }
    openCompareWindow({
      title: `${where} — ${image.name}`,
      targets,
      processed: image,
    });
  };

  /**
   * Opens the panel cropper for the panel row `step` (docs/specs/flow-canvas.md 「コマの切り直し」); false when the
   * page before the split or the panel's box (panels.json) is unknown.
   */
  const openCropper = async (step: FlowStep): Promise<boolean> => {
    const panel = step.panel;
    const pageKey = hiddenPage(step);
    const name = archive;
    const split = panel && graph?.runOfImage.get(panel.key);
    if (!graph || !name || !panel || !split || !pageKey || !graph.images.has(pageKey)) return false;
    // The box of the panel as split (panels.json), or as added (its コマ追加 info.json).
    const splitBox = panelVersions(graph, panel).versions[0]?.box ?? (await panelBoxOf(split.folder, panel.name));
    if (!splitBox) return false;
    const versionsNow = () =>
      graph && archive === name && graph.images.has(panel.key) ? panelVersions(graph, panel) : null;
    openPanelCropper({
      title: `コマ ${step.panelIndex} — ${panel.name}`,
      loadPage: () => fetchArchiveKey(pageKey),
      state: () => {
        const now = versionsNow();
        const shown = graph && now ? shownVersion(graph, panel) : null;
        if (!now || !shown) return null;
        return {
          versions: now.versions.map(v => ({ label: v.label, createdAt: v.run.created_at, box: v.box ?? splitBox })),
          shown: Math.max(
            0,
            now.versions.findIndex(v => v.run.folder === shown.run.folder),
          ),
        };
      },
      pick: async index => {
        const now = versionsNow();
        const version = now?.versions[index];
        if (now?.stackId && version) await showRun(now.stackId, version.run.folder);
      },
      recrop: async box => {
        try {
          const result = await recropPanel(panel.key, box);
          // The new version is shown at once, even when an earlier one was picked.
          const stackId = stackIdOf({ source: panel.key, tool: RECROP_TOOL, folder: result.folder });
          await setFlowSelection(name, stackId, result.folder).catch(err =>
            showError('表示する版を保存できませんでした', err),
          );
          await reload(name, { select: [result.key] });
          showToast(`コマ ${step.panelIndex} を切り出し直しました`, 'success');
          return true;
        } catch (err) {
          showError('コマを切り出し直せませんでした', err);
          return false;
        }
      },
    });
    return true;
  };

  /** The box on the page of the shown version of a panel row's panel (panels.json for a panel as split). */
  const panelBox = async (step: FlowStep | null, splitFolder: string): Promise<PageBox | null> => {
    const panel = step?.panel;
    if (!graph || !panel) return null;
    return shownVersion(graph, panel)?.box ?? (await panelBoxOf(splitFolder, panel.name));
  };

  /**
   * ＋ between the panel rows (docs/specs/flow-canvas.md 「コマの追加」): the panel cropper in add mode, the frame
   * starting between the panels around it; the new panel is saved as a コマ追加 result and selected.
   */
  const openAdder = async (gap: PanelGap) => {
    const split = graph && splitPageOf(graph);
    const name = archive;
    if (!graph || !split || !name) return;
    const [above, below] = await Promise.all([
      panelBox(gap.after, split.split.folder),
      panelBox(gap.before, split.split.folder),
    ]);
    const pageHeight = split.page.height ?? Math.max(above?.[3] ?? 0, below?.[3] ?? 0);
    const start = newPanelBox(above, below, pageHeight);
    if (!start) {
      showError('隣のコマの範囲が分からないため、コマを追加できません（panels.json を読めません）');
      return;
    }
    openPanelCropper({
      title: `コマの追加 — ${gapText(gap)}`,
      loadPage: () => fetchArchiveKey(split.page.key),
      add: {
        start,
        save: async box => {
          try {
            const result = await addPanel(
              split.split.folder,
              box,
              gap.after?.panel?.key ?? null,
              gap.before?.panel?.key ?? null,
            );
            await reload(name, { select: [result.key] });
            const index = flow?.stepOfCell.get(result.key)?.panelIndex;
            showToast(index ? `コマ ${index} を追加しました` : 'コマを追加しました', 'success');
            return true;
          } catch (err) {
            showError('コマを追加できませんでした', err);
            return false;
          }
        },
      },
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
      : step.added
        ? 'このコマを削除'
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
      // A panel row deletes its whole コマ分割 (an added panel: itself), whatever version is shown.
      item(deleteLabel, 'delete', () => void deleteKeys(step.panel ? [step.panel.key] : step.cells.map(c => c.key))),
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
    const archiveName = archives.find(a => a.key === graph?.archive)?.name ?? graph.archive;
    const targets = deletionTargets(graph, plan, archiveName);
    if (!targets.length && !plan.panels.length) return;
    // Panel rows deleted (as split: marked; added: their コマ追加 run) are named by their row: "コマ 2".
    const panelNames = plan.panels.map(k => `コマ ${flowPanelIndex(k)}`);
    const added = keys.filter(k => graph?.runOfImage.get(k)?.tool === ADD_TOOL && flowPanelIndex(k) !== '');
    const rowNames = [...panelNames, ...added.map(k => `コマ ${flowPanelIndex(k)}`)];
    const chosen = targets.length - plan.downstream - added.length;
    const results = `選択した${plan.roots.length ? '画像・' : ''}結果`;
    const what = !rowNames.length
      ? `${results}を削除します（${chosen} 件）。`
      : `${rowNames.join('・')}${chosen ? ` と${results}（${chosen} 件）` : ''} を削除します。`;
    const message = plan.whole
      ? `アーカイブ「${archiveName}」を削除します（開始画像と結果 ${plan.runs.length} 件）。`
      : [what, plan.downstream ? `この先の結果 ${plan.downstream} 件も一緒に削除されます。` : ''].join('');
    const panels = plan.panels.length
      ? { archive: graph.archive, keys: plan.panels, label: panelNames.join('・') }
      : null;
    const ok = await confirmDialog({
      title: '削除の確認',
      message: `${message}\nCtrl+Z で元に戻せます（アプリを終了するまで）。`,
      confirmLabel: '削除',
    });
    if (ok) await deleteTargets(targets, panels);
  };

  /** The row number of the panel `key` (its row may show another version of it). */
  const flowPanelIndex = (key: string) =>
    [...(flow?.steps.values() ?? [])].find(s => s.panel?.key === key)?.panelIndex ?? '';

  // ── Pointer: rectangle selection (Shift + drag), background click ──
  let gesture: {
    kind: 'click' | 'band';
    x: number;
    y: number;
    moved: boolean;
    base: string[];
  } | null = null;

  /** Client position -> world position (the world scrolls with the viewport). */
  const toWorld = (clientX: number, clientY: number) => {
    const r = world.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  /** On a scroll bar of the viewport (not its content). */
  const onScrollbar = (e: MouseEvent) => {
    const r = viewport.getBoundingClientRect();
    return e.clientX - r.left >= viewport.clientWidth || e.clientY - r.top >= viewport.clientHeight;
  };

  viewport.addEventListener('pointerdown', e => {
    const target = e.target as HTMLElement;
    if (
      e.button !== 0 ||
      onScrollbar(e) ||
      target.closest('.flow-step, .flow-row__label, .flow-insert, .flow-row-tools')
    )
      return;
    closeMenu?.();
    gesture = { kind: e.shiftKey ? 'band' : 'click', x: e.clientX, y: e.clientY, moved: false, base: [...selected] };
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener('pointermove', e => {
    if (!gesture) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    gesture.moved = true;
    if (gesture.kind !== 'band') return;
    const a = toWorld(gesture.x, gesture.y);
    const b = toWorld(e.clientX, e.clientY);
    const area = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    Object.assign(band.style, {
      display: 'block',
      left: `${area.x}px`,
      top: `${area.y}px`,
      width: `${area.w}px`,
      height: `${area.h}px`,
    });
    const inside = layout ? [...layout.cells].filter(([, r]) => intersects(area, r)).map(([k]) => k) : [];
    setSelected([...gesture.base, ...inside]);
  });
  const endGesture = () => {
    if (gesture && !gesture.moved && gesture.kind === 'click') setSelected([]);
    gesture = null;
    band.style.display = 'none';
  };
  viewport.addEventListener('pointerup', endGesture);
  viewport.addEventListener('pointercancel', endGesture);

  // No zoom, also not the browser's with Ctrl: Ctrl + wheel scrolls like the wheel.
  viewport.addEventListener(
    'wheel',
    e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      viewport.scrollBy(e.deltaX, e.deltaY);
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
      // The cells of the flow: not the side panes' rows (the page itself would go with a deletion).
      setSelected([...cellElements.keys()].filter(k => !isSideRow(flow?.stepOfCell.get(k))));
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

  // 新規作成: an empty archive with the name entered, shown at once (its images come with 画像読み込み / a drop).
  newButton.addEventListener('click', async () => {
    // Filled by the dialog when the archive was made.
    const result: { archive?: { key: string; name: string } } = {};
    await inputDialog({
      title: 'アーカイブの新規作成',
      label: '名前',
      placeholder: '例: 第2話',
      confirmLabel: '作成',
      submit: async name => {
        try {
          result.archive = await createArchive(name);
          return null;
        } catch (err) {
          return describeError(err).message;
        }
      },
    });
    if (!result.archive) return;
    const { key, name } = result.archive;
    await reload(key, { fit: true });
    showToast(`「${name}」を作成しました`, 'success');
  });

  // 書き出し: the selection, or every panel's 「最終」 image when nothing is selected.
  exportButton.addEventListener('click', () => {
    void downloadImages(selected.length || !graph ? selected : finalImages(graph, panelRows()));
  });
  deleteButton.addEventListener('click', () => void deleteSelection());
  undoButton.addEventListener('click', () => void historyManager.undo());
  redoButton.addEventListener('click', () => void historyManager.redo());
  // 画像読み込み: the tool's ▶ (the file dialog at once; into the shown archive while it is empty).
  importButton.addEventListener('click', () => {
    const loader = TOOLS.find(t => t.id === 'image-loader');
    if (loader) void playTool(loader);
  });
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
  // The row tool buttons: ⏸ on the running tool's, the others dimmed (like the TOOLS list).
  on('tool:start', ({ toolName }) => {
    for (const { name, button } of [...rowToolButtons, ...paneToolButtons]) button.setRunning(name === toolName);
    main.classList.add('flow-canvas--busy');
  });
  on('tool:end', () => {
    for (const { button } of [...rowToolButtons, ...paneToolButtons]) button.setRunning(false);
    main.classList.remove('flow-canvas--busy');
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

  void (async () => {
    await refreshArchives();
    const saved = settings.get('archive', '');
    await reload(saved || null, { fit: true });
  })();
  updateEmptyState();
  return main;
}
