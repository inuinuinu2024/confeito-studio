/**
 * Canvas — the central viewing area: two panes (left/right) holding a scrolling viewport with one
 * <canvas>, a text overlay and an empty-pane notice each, the zoom bar, and the floating
 * Parallel / Overlay toolbars.
 *
 * The panes are fixed frames: side by side in Parallel mode (a 1px boundary between them), stacked
 * with the front one clipped at a screen-fixed divider in the slider view, and only the left one in
 * the other modes. Pan and zoom move the images inside both panes together (zoom.ts).
 *
 * Inputs (events):  archive:item-selected(:right), archive:selection-cleared(:right),
 *                   archive:selection-summary(:right), archive:batch-selected, overlay:underdrawing-selected(:right),
 *                   <mode>-mode:toggle, document:loaded/redraw, canvas:bg-color
 * Drawing:          render.ts (from CanvasState in canvas-state.ts)
 * Zoom / scroll:    zoom.ts
 * Nothing to show:  a centred message asks the user to pick an image (emptyCanvasMessage; per pane in
 *                   Parallel mode, emptyPaneMessage).
 * Image files dropped on the area are imported by running the image loader tool.
 */
import './canvas.css';
import { fetchArchiveKey } from '../../shared/api/archives';
import { IMAGE_FILE_PATTERN, TEXT_FILE_PATTERN } from '../../shared/config';
import { emit, on, type SelectionSummary } from '../../shared/events';
import { h, icon, setShown } from '../../shared/ui/dom';
import { showError, showToast } from '../../shared/ui/toast';
import { blobToCanvas } from '../../shared/utils/image';
import { runTool } from '../ai-panel/tool-runner';
import { DocumentManager } from '../document/DocumentManager';
import { importImageTool } from '../tools/image-loader';
import {
  type BatchImage,
  contentSize,
  createCanvasState,
  emptyCanvasMessage,
  emptyPaneMessage,
  isZoomBarShown,
  type Side,
  sliderClip,
} from './canvas-state';
import { batchGridSize, renderSide, topImageRect } from './render';
import { createOverlayToolbar, createParallelToolbar } from './toolbars';
import { createZoomController } from './zoom';

const SIDES = ['left', 'right'] as const;

const isTextBlob = (name: string, blob: Blob) =>
  TEXT_FILE_PATTERN.test(name) || blob.type.startsWith('text/') || blob.type === 'application/json';

export function createCanvas(): HTMLElement {
  const state = createCanvasState();
  const canvases: Record<Side, HTMLCanvasElement | null> = { left: null, right: null };

  // ── DOM ──
  const main = h('main', { class: 'canvas-area' });
  /** Pane (fixed frame) > viewport (scrolls) > inner (sized by zoom.ts) > canvas; text and notice over the viewport. */
  const createPane = (side: Side) => {
    const inner = h('div', { class: 'canvas-split__inner' });
    const viewport = h('div', { class: 'canvas-split__viewport' }, inner);
    const text = h('div', { class: 'canvas-text-overlay' });
    const message = h('span', { class: 'canvas-split__pane-message' });
    const notice = h('div', { class: 'canvas-split__pane-empty' }, icon('image', 40), message);
    const el = h('div', { class: `canvas-split__pane canvas-split__pane--${side}` }, viewport, text, notice);
    return { el, viewport, inner, text, notice, message };
  };
  const panes = { left: createPane('left'), right: createPane('right') };
  const divider = h(
    'div',
    { class: 'canvas-split__divider' },
    h('div', { class: 'canvas-split__divider-handle' }, icon('drag_indicator', 14)),
  );
  const split = h('div', { class: 'canvas-split' }, panes.left.el, panes.right.el, divider);

  const zoom = createZoomController(state, panes);

  const emptyMessage = h('span', { class: 'canvas-empty__message' });
  const emptyState = h(
    'div',
    { class: 'canvas-empty' },
    icon('image', 48),
    emptyMessage,
    h('span', { class: 'canvas-empty__hint', text: 'または画像ファイルをここにドロップして読み込み' }),
  );

  const parallelToolbar = createParallelToolbar({
    onSlider: () => {
      if (!state.slider && !state.parallel) return; // the slider compares the two Parallel-mode panes
      state.slider = !state.slider;
      if (!state.slider) resetSliderOptions();
      parallelToolbar.slider.set(state.slider);
      updateLayout();
    },
    onVertical: () => {
      state.vertical = !state.vertical;
      parallelToolbar.vertical.set(state.vertical);
      updateLayout();
    },
    onFlip: () => {
      state.flipped = !state.flipped;
      parallelToolbar.flip.set(state.flipped);
      updateLayout();
    },
  });
  const overlayToolbar = createOverlayToolbar({
    initialTint: state.tint,
    onTint: tint => {
      state.tint = tint;
      redraw();
    },
    onOpacity: percent => {
      state.topOpacity = percent;
      redraw();
    },
    onResetPosition: () => {
      state.sides.left.topOffset = { x: 0, y: 0 };
      state.sides.right.topOffset = { x: 0, y: 0 };
      redraw();
    },
  });
  setShown(overlayToolbar, false);
  const toolbar = h('div', { class: 'canvas-toolbar' }, parallelToolbar.el, overlayToolbar);
  main.append(toolbar, zoom.bar, split, emptyState);

  // ── Rendering ──
  function redraw(): void {
    for (const side of SIDES) {
      const ctx = canvases[side]?.getContext('2d');
      if (ctx) renderSide(ctx, state, side);
    }
    updateTooltips();
    updateEmptyState();
  }

  function updateEmptyState(): void {
    const message = emptyCanvasMessage(state);
    if (message !== null) emptyMessage.textContent = message;
    setShown(emptyState, message !== null, 'flex');
    for (const side of SIDES) {
      const paneMessage = emptyPaneMessage(state, side);
      if (paneMessage !== null) panes[side].message.textContent = paneMessage;
      setShown(panes[side].notice, paneMessage !== null, 'flex');
    }
  }

  function updateTooltips(): void {
    if (!canvases.left || !canvases.right) return;
    const size = (img: HTMLCanvasElement | null) => (img ? `${img.width} x ${img.height}px` : null);
    const fallback = `${state.drawW} x ${state.drawH}px`;
    const { left, right } = state.sides;
    canvases.left.title = (!state.overlay && state.parallel && size(left.image)) || fallback;
    canvases.right.title = (!state.overlay && state.parallel ? size(right.image) : size(left.image)) || fallback;
  }

  /** (Re)creates both canvases when the base size changes. */
  function initializeCanvases(width: number, height: number): void {
    if (canvases.left && canvases.right && state.baseW === width && state.baseH === height) return;
    state.baseW = state.drawW = width;
    state.baseH = state.drawH = height;
    for (const side of SIDES) {
      const canvas = h('canvas', { class: 'canvas-split__canvas', width, height, title: `${width} x ${height}px` });
      canvases[side] = canvas;
      const ctx = canvas.getContext('2d');
      if (ctx) renderSide(ctx, state, side);
      panes[side].inner.replaceChildren(canvas);
    }
    updateTooltips();
  }

  /** Resizes the canvases to the content of the current mode and re-applies the zoom. */
  function updateDrawSize(fit: boolean): void {
    if (!state.parallel && state.sides.left.text) return; // the text overlay covers the pane
    const { w, h: height } = contentSize(state);
    if (!w || !height) return;
    const sizeChanged = state.drawW !== w || state.drawH !== height;
    state.drawW = w;
    state.drawH = height;
    if (!canvases.left || !canvases.right) {
      initializeCanvases(w, height);
    } else {
      for (const canvas of [canvases.left, canvases.right]) {
        if (canvas.width !== w || canvas.height !== height) {
          canvas.width = w;
          canvas.height = height;
        }
      }
    }
    if (fit) zoom.fitToScreen();
    else if (sizeChanged) zoom.resetTo100();
    else zoom.apply(state.zoom, undefined, undefined, true);
    updateTooltips();
  }

  function setText(side: Side, text: string | null): void {
    state.sides[side].text = text !== null;
    if (text !== null) panes[side].text.textContent = text;
    panes[side].text.style.display = text !== null ? 'block' : 'none';
    panes[side].el.classList.toggle('canvas-split__pane--text', text !== null);
  }

  function resetSliderOptions(): void {
    state.slider = state.vertical = state.flipped = false;
    state.splitPct = 50;
    parallelToolbar.slider.set(false);
    parallelToolbar.vertical.set(false);
    parallelToolbar.flip.set(false);
  }

  function updateLayout(): void {
    setShown(zoom.bar, isZoomBarShown(state), 'flex');
    setShown(parallelToolbar.el, state.parallel, 'flex');
    setShown(toolbar, state.parallel || state.overlay, 'flex');
    parallelToolbar.showSliderOptions(state.slider);

    // The pane size (the 100% basis) changes with the layout.
    zoom.relayout(() => {
      setShown(panes.right.el, state.parallel);
      split.classList.toggle('canvas-split--parallel', state.parallel && !state.slider);
      split.classList.toggle('canvas-split--slider', state.slider);
      split.classList.toggle('canvas-split--vertical', state.slider && state.vertical);
      for (const side of SIDES) {
        panes[side].el.classList.remove('canvas-split__pane--front');
        panes[side].el.style.clipPath = '';
      }
      if (state.slider) {
        frontPane().el.classList.add('canvas-split__pane--front');
        applySplit();
      }
    });
  }

  /** Slider view: the pane drawn in front, shown before the divider (the left one, or the right one when flipped). */
  const frontPane = () => (state.flipped ? panes.right : panes.left);

  /** Clips the front pane at state.splitPct and moves the divider there (both fixed to the screen). */
  function applySplit(): void {
    split.style.setProperty('--split-pct', `${state.splitPct}%`);
    frontPane().el.style.clipPath = sliderClip(state.splitPct, state.vertical);
  }

  // ── Pointer interaction: pan, slider divider, Overlay T drag/select ──
  let pan: { viewport: HTMLElement; x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;
  let draggingDivider = false;
  let topDrag: { side: Side; x: number; y: number; offsetX: number; offsetY: number } | null = null;

  /** Pane under the pointer (in the slider view, the clipped-off part of the front pane belongs to the back one). */
  const paneSide = (target: EventTarget | null): Side =>
    state.parallel && (target as HTMLElement | null)?.closest?.('.canvas-split__pane') === panes.right.el
      ? 'right'
      : 'left';

  /** Side under the pointer and the pointer position in canvas pixels (Overlay mode hit testing). */
  const canvasPoint = (e: MouseEvent) => {
    const side = paneSide(e.target);
    const canvas = canvases[side];
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / state.drawW, rect.height / state.drawH);
    return {
      side,
      scale,
      x: (e.clientX - rect.left - (rect.width - state.drawW * scale) / 2) / scale,
      y: (e.clientY - rect.top - (rect.height - state.drawH * scale) / 2) / scale,
    };
  };
  const hitsTop = (side: Side, x: number, y: number) => {
    const r = topImageRect(state, side);
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  };
  const isControl = (target: EventTarget | null) =>
    !!(target as HTMLElement).closest('.canvas-split__divider, .canvas-toolbar, .canvas-zoom-bar');

  split.addEventListener('mousedown', e => {
    if (isControl(e.target) || (e.target as HTMLElement).closest('.canvas-text-overlay')) return;
    if (state.overlay) {
      const p = canvasPoint(e);
      const me = p && state.sides[p.side];
      if (p && me?.image && me.topSelected) {
        if (hitsTop(p.side, p.x, p.y)) {
          topDrag = { side: p.side, x: e.clientX, y: e.clientY, offsetX: me.topOffset.x, offsetY: me.topOffset.y };
          document.body.style.cursor = 'move';
          return;
        }
        me.topSelected = false; // clicking outside T deselects it
        redraw();
      }
    }
    const { viewport } = panes[paneSide(e.target)];
    pan = { viewport, x: e.clientX, y: e.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    document.body.style.cursor = 'grabbing';
  });

  split.addEventListener('dblclick', e => {
    if (!state.overlay || isControl(e.target)) return;
    const p = canvasPoint(e);
    if (p && hitsTop(p.side, p.x, p.y)) {
      state.sides[p.side].topSelected = !state.sides[p.side].topSelected;
      redraw();
    }
  });

  divider.addEventListener('mousedown', e => {
    e.preventDefault();
    draggingDivider = true;
    document.body.style.cursor = state.vertical ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', e => {
    if (draggingDivider) {
      const rect = split.getBoundingClientRect();
      const pos = state.vertical ? (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width;
      state.splitPct = Math.max(0, Math.min(100, pos * 100));
      applySplit();
    }
    if (pan) {
      pan.viewport.scrollLeft = pan.scrollLeft + (pan.x - e.clientX);
      pan.viewport.scrollTop = pan.scrollTop + (pan.y - e.clientY);
      zoom.syncScroll(pan.viewport);
    }
    if (topDrag) {
      const canvas = canvases[topDrag.side];
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const scale = Math.min(rect.width / state.drawW, rect.height / state.drawH);
        state.sides[topDrag.side].topOffset = {
          x: topDrag.offsetX + (e.clientX - topDrag.x) / scale,
          y: topDrag.offsetY + (e.clientY - topDrag.y) / scale,
        };
        redraw();
      }
    }
  });

  window.addEventListener('mouseup', () => {
    if (draggingDivider || pan || topDrag) document.body.style.cursor = '';
    if (draggingDivider) document.body.style.userSelect = '';
    draggingDivider = false;
    pan = null;
    topDrag = null;
  });

  // Overlay mode: arrow keys move the selected T (Shift = 10px).
  window.addEventListener('keydown', e => {
    if (!state.overlay || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const step = e.shiftKey ? 10 : 1;
    const delta = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key];
    if (!delta) return;
    for (const side of SIDES) {
      const me = state.sides[side];
      if (me.topSelected) me.topOffset = { x: me.topOffset.x + delta[0], y: me.topOffset.y + delta[1] };
    }
    redraw();
    e.preventDefault();
  });

  main.addEventListener(
    'wheel',
    e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // Both panes have the same size: the point in the pane under the cursor is the focus for both.
      const rect = panes[paneSide(e.target)].viewport.getBoundingClientRect();
      zoom.zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false },
  );

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

  // ── View modes ──
  on('parallel-mode:toggle', ({ enabled }) => {
    state.parallel = enabled;
    if (enabled) {
      // The right ARCHIVES panel starts with the left panel's selection: show the same on the right.
      const { left, right } = state.sides;
      right.image = left.image;
      right.summary = left.summary;
      setText('right', left.text ? panes.left.text.textContent : null);
    } else {
      resetSliderOptions();
      // The right pane is hidden outside Parallel mode: drop what it showed.
      selectionRequest.right++;
      state.sides.right.image = null;
      state.sides.right.summary = null;
      setText('right', null);
      panes.right.text.textContent = '';
    }
    updateLayout();
    updateDrawSize(false); // Parallel: both images' bounding box; back in Normal: the left image's own size
    zoom.resetTo100();
    redraw();
  });

  on('overlay-mode:toggle', ({ enabled }) => {
    state.overlay = enabled;
    setShown(overlayToolbar, enabled, 'flex');
    if (enabled && !state.sides.left.underdrawing) {
      state.sides.left.underdrawing = state.sides.left.image ?? state.docImage;
    }
    updateDrawSize(true);
    updateLayout();
    redraw();
  });

  on('batch-mode:toggle', ({ enabled }) => {
    state.batch = enabled;
    if (!enabled) {
      state.batchImages = [];
      updateDrawSize(false); // leave the grid size (ArchivePanel re-publishes its selection)
    }
    updateLayout();
    redraw();
  });

  // ── Document ──
  on('document:loaded', ({ canvas, width, height }) => {
    state.docImage = canvas;
    if (width && height) {
      initializeCanvases(width, height);
      updateDrawSize(false);
      zoom.resetTo100();
      updateLayout();
      redraw();
    }
  });

  on('document:redraw', redraw);

  on('canvas:bg-color', ({ color }) => {
    state.bgColor = color;
    redraw();
  });

  // ── ARCHIVES selection ──
  // Selections can change while a file loads: only the latest request of each side is shown.
  const selectionRequest: Record<Side, number> = { left: 0, right: 0 };

  const showSelection = async (side: Side, key: string, name: string) => {
    const request = ++selectionRequest[side];
    const isLatest = () => request === selectionRequest[side];
    const blob = await fetchArchiveKey(key);
    if (!isLatest()) return;
    if (!blob) return loadFailed(side, name);
    if (isTextBlob(name, blob)) {
      const text = await blob.text();
      if (!isLatest()) return;
      setText(side, text);
      state.sides[side].image = null;
      state.sides[side].summary = null;
      if (side === 'left') clearDocument(); // tools have no image while a text file is shown
      if (!canvases.left) initializeCanvases(800, 600);
      updateDrawSize(true);
      updateLayout();
      redraw();
      return;
    }
    const image = await blobToCanvas(blob);
    if (!isLatest()) return;
    if (!image) return loadFailed(side, name);
    setText(side, null);
    state.sides[side].image = image;
    state.sides[side].summary = null;
    // The save folder was already set by ArchivePanel (the file's parent folder).
    if (side === 'left') DocumentManager.getInstance().setCanvas(image, name, key); // emits document:loaded synchronously
    if (!canvases.left) initializeCanvases(image.width, image.height);
    updateDrawSize(false);
    zoom.resetTo100();
    updateLayout();
    redraw();
  };

  /** DocumentManager has no image now (tools see nothing; Overlay must not show the old one). */
  const clearDocument = () => {
    state.docImage = null;
    DocumentManager.getInstance().setCanvas(null);
  };

  /** Shows nothing on this side; `summary` (a folder / several entries selected) words the empty message. */
  const showNothing = (side: Side, summary: SelectionSummary | null) => {
    selectionRequest[side]++;
    state.sides[side].image = null;
    state.sides[side].summary = summary;
    setText(side, null);
    if (side === 'left') clearDocument();
    updateDrawSize(true);
    updateLayout();
    redraw();
  };

  const loadFailed = (side: Side, name: string) => {
    showError(`「${name}」を読み込めませんでした`);
    showNothing(side, null);
  };

  const clearSelection = (side: Side) => {
    if (side === 'left') {
      state.batchImages = [];
      // Nothing selected -> no save folder either, so tools never write into the previous selection.
      DocumentManager.getInstance().setCurrentArchiveFolder(null);
    }
    showNothing(side, null);
  };

  on('archive:item-selected', ({ key, name }) => void showSelection('left', key, name));
  on('archive:item-selected:right', ({ key, name }) => void showSelection('right', key, name));
  on('archive:selection-cleared', () => clearSelection('left'));
  on('archive:selection-cleared:right', () => clearSelection('right'));
  on('archive:selection-summary', summary => showNothing('left', summary));
  on('archive:selection-summary:right', summary => showNothing('right', summary));

  // Selections can change while images load (Ctrl+click): only the latest request is shown.
  let batchRequest = 0;
  on('archive:batch-selected', async ({ items }) => {
    if (!state.batch) return;
    const request = ++batchRequest;
    const images: BatchImage[] = [];
    for (const item of items) {
      const blob = await fetchArchiveKey(item.key);
      const canvas =
        blob && !blob.type.startsWith('text/') && blob.type !== 'application/json' ? await blobToCanvas(blob) : null;
      images.push({ key: item.key, name: item.name, canvas });
    }
    if (request !== batchRequest || !state.batch) return;
    state.batchImages = images;
    const grid = batchGridSize(images.filter(i => i.canvas).length);
    initializeCanvases(grid.w, grid.h);
    updateDrawSize(false);
    zoom.resetTo100();
    updateLayout();
    redraw();
  });

  on('overlay:underdrawing-selected', async ({ cacheKey }) => {
    state.sides.left.underdrawing = await loadArchiveCanvas(cacheKey);
    updateDrawSize(true);
    emit('document:redraw');
  });
  on('overlay:underdrawing-selected:right', async ({ cacheKey }) => {
    state.sides.right.underdrawing = await loadArchiveCanvas(cacheKey);
    updateDrawSize(true);
    emit('document:redraw');
  });

  updateLayout();
  updateEmptyState();
  return main;
}

async function loadArchiveCanvas(key: string | null): Promise<HTMLCanvasElement | null> {
  if (!key) return null;
  const blob = await fetchArchiveKey(key);
  return blob && blob.type.startsWith('image/') ? blobToCanvas(blob) : null;
}
