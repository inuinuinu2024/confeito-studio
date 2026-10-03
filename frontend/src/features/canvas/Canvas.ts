/**
 * Canvas — the central viewing area: two panes (left/right) holding a scrolling viewport with one
 * <canvas> and an empty-pane notice each (the left one also a text overlay), the zoom bar, and the
 * floating Parallel / Overlay toolbars.
 *
 * The panes are fixed frames: side by side in Parallel mode (a 1px boundary between them), stacked
 * with the front one clipped at a screen-fixed divider in the slider view, and only the left one in
 * the other modes. Pan and zoom move the images inside both panes together (zoom.ts).
 *
 * Inputs (events):  archive:item-selected, archive:selection-cleared, archive:selection-summary,
 *                   archive:batch-selected, view:layer-selected, archives:changed, <mode>-mode:toggle,
 *                   document:loaded/redraw, canvas:bg-color
 * Drawing:          render.ts (from CanvasState in canvas-state.ts)
 * Zoom / scroll:    zoom.ts
 * Nothing to show:  a centred message asks the user to pick an image (emptyCanvasMessage; per pane in
 *                   Parallel mode, emptyPaneMessage).
 * Image files dropped on the area are imported by running the image loader tool (Normal / Batch mode).
 *
 * Parallel and Overlay mode show the layers chosen with the ARCHIVES checkboxes (L / R, U / T). The
 * ARCHIVES selection is still tracked (state.selection, DocumentManager) but not shown until the mode ends.
 */
import './canvas.css';
import { fetchArchiveKey } from '../../shared/api/archives';
import { IMAGE_FILE_PATTERN, TEXT_FILE_PATTERN } from '../../shared/config';
import { emit, on, type SelectionSummary, type ViewLayer } from '../../shared/events';
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
  isComparing,
  isZoomBarShown,
  type Side,
  sliderClip,
} from './canvas-state';
import { batchGridSize, renderSide, topImageRect } from './render';
import { createOverlayToolbar, createParallelToolbar } from './toolbars';
import { createZoomController } from './zoom';

const SIDES = ['left', 'right'] as const;
const LAYERS = ['under', 'top', 'left', 'right'] as const;

const isTextBlob = (name: string, blob: Blob) =>
  TEXT_FILE_PATTERN.test(name) || blob.type.startsWith('text/') || blob.type === 'application/json';

export function createCanvas(): HTMLElement {
  const state = createCanvasState();
  const canvases: Record<Side, HTMLCanvasElement | null> = { left: null, right: null };

  // ── DOM ──
  const main = h('main', { class: 'canvas-area' });
  /** Pane (fixed frame) > viewport (scrolls) > inner (sized by zoom.ts) > canvas; notice over the viewport. */
  const createPane = (side: Side) => {
    const inner = h('div', { class: 'canvas-split__inner' });
    const viewport = h('div', { class: 'canvas-split__viewport' }, inner);
    const message = h('span', { class: 'canvas-split__pane-message' });
    const notice = h('div', { class: 'canvas-split__pane-empty' }, icon('image', 40), message);
    const el = h('div', { class: `canvas-split__pane canvas-split__pane--${side}` }, viewport, notice);
    return { el, viewport, inner, notice, message };
  };
  const panes = { left: createPane('left'), right: createPane('right') };
  /** A selected text file (Normal mode) covers the left pane. */
  const textOverlay = h('div', { class: 'canvas-text-overlay' });
  panes.left.el.append(textOverlay);
  const divider = h(
    'div',
    { class: 'canvas-split__divider' },
    h('div', { class: 'canvas-split__divider-handle' }, icon('drag_indicator', 14)),
  );
  const split = h('div', { class: 'canvas-split' }, panes.left.el, panes.right.el, divider);

  // The T selection frame is drawn one screen pixel wide: redraw it when the displayed size changes.
  const zoom = createZoomController(state, panes, () => {
    if (state.overlay && state.topSelected) redraw();
  });

  const emptyMessage = h('span', { class: 'canvas-empty__message' });
  const emptyHint = h('span', { class: 'canvas-empty__hint', text: 'または画像ファイルをここにドロップして読み込み' });
  const emptyState = h('div', { class: 'canvas-empty' }, icon('image', 48), emptyMessage, emptyHint);

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
      state.topOffset = { x: 0, y: 0 };
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
    setShown(emptyHint, !isComparing(state)); // nothing is imported in Parallel / Overlay mode
    for (const side of SIDES) {
      const paneMessage = emptyPaneMessage(state, side);
      if (paneMessage !== null) panes[side].message.textContent = paneMessage;
      setShown(panes[side].notice, paneMessage !== null, 'flex');
    }
  }

  function updateTooltips(): void {
    const size = (img: HTMLCanvasElement | null) => (img ? `${img.width} x ${img.height}px` : null);
    const fallback = `${state.drawW} x ${state.drawH}px`;
    for (const side of SIDES) {
      const canvas = canvases[side];
      if (canvas) canvas.title = (state.parallel && size(state.layers[side])) || fallback;
    }
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
    if (!isComparing(state) && state.selection.text) return; // the text overlay covers the pane
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

  function setText(text: string | null): void {
    state.selection.text = text !== null;
    if (text !== null) textOverlay.textContent = text;
    syncTextVisibility();
  }

  /** A selected text file is shown in Normal mode only (Parallel / Overlay show their layers). */
  function syncTextVisibility(): void {
    const shown = state.selection.text && !isComparing(state);
    textOverlay.style.display = shown ? 'block' : 'none';
    panes.left.el.classList.toggle('canvas-split__pane--text', shown);
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
    setShown(toolbar, isComparing(state), 'flex');
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
  let topDrag: { x: number; y: number; offsetX: number; offsetY: number } | null = null;

  /** Pane under the pointer (in the slider view, the clipped-off part of the front pane belongs to the back one). */
  const paneSide = (target: EventTarget | null): Side =>
    state.parallel && (target as HTMLElement | null)?.closest?.('.canvas-split__pane') === panes.right.el
      ? 'right'
      : 'left';

  /** Screen pixels per canvas pixel of the left canvas (the one Overlay mode draws on). */
  const screenScale = (rect: DOMRect) => Math.min(rect.width / state.drawW, rect.height / state.drawH);

  /** Overlay mode: is the pointer over T (in the left pane)? */
  const hitsTop = (e: MouseEvent) => {
    const r = topImageRect(state);
    if (!r || !canvases.left) return false;
    const rect = canvases.left.getBoundingClientRect();
    const scale = screenScale(rect);
    const x = (e.clientX - rect.left - (rect.width - state.drawW * scale) / 2) / scale;
    const y = (e.clientY - rect.top - (rect.height - state.drawH * scale) / 2) / scale;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  };
  const isControl = (target: EventTarget | null) =>
    !!(target as HTMLElement).closest('.canvas-split__divider, .canvas-toolbar, .canvas-zoom-bar');

  split.addEventListener('mousedown', e => {
    if (isControl(e.target) || (e.target as HTMLElement).closest('.canvas-text-overlay')) return;
    if (state.overlay && state.topSelected) {
      if (hitsTop(e)) {
        topDrag = { x: e.clientX, y: e.clientY, offsetX: state.topOffset.x, offsetY: state.topOffset.y };
        document.body.style.cursor = 'move';
        return;
      }
      state.topSelected = false; // clicking outside T deselects it
      redraw();
    }
    const { viewport } = panes[paneSide(e.target)];
    pan = { viewport, x: e.clientX, y: e.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
    document.body.style.cursor = 'grabbing';
  });

  split.addEventListener('dblclick', e => {
    if (!state.overlay || isControl(e.target) || !hitsTop(e)) return;
    state.topSelected = !state.topSelected;
    redraw();
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
    if (topDrag && canvases.left) {
      const scale = screenScale(canvases.left.getBoundingClientRect());
      state.topOffset = {
        x: topDrag.offsetX + (e.clientX - topDrag.x) / scale,
        y: topDrag.offsetY + (e.clientY - topDrag.y) / scale,
      };
      redraw();
    }
  });

  window.addEventListener('mouseup', () => {
    if (draggingDivider || pan || topDrag) document.body.style.cursor = '';
    if (draggingDivider) document.body.style.userSelect = '';
    draggingDivider = false;
    pan = null;
    topDrag = null;
  });

  // Overlay mode: arrow keys move the selected T (Shift = 10px). Otherwise they scroll as usual.
  const isEditable = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
  window.addEventListener('keydown', e => {
    if (!state.overlay || !state.topSelected || !state.layers.top || isEditable(e.target)) return;
    const step = e.shiftKey ? 10 : 1;
    const delta = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key];
    if (!delta) return;
    state.topOffset = { x: state.topOffset.x + delta[0], y: state.topOffset.y + delta[1] };
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
    if (isComparing(state)) {
      const mode = state.parallel ? 'Parallel' : 'Overlay';
      showToast(`${mode} モードでは画像を取り込めません。Normal モードに戻してからドロップしてください`, 'warning');
      return;
    }
    if (file.type.startsWith('image/') || IMAGE_FILE_PATTERN.test(file.name)) await runTool(importImageTool(file));
    else showToast('画像ファイル（PNG/JPG/WebP/BMP/GIF）をドロップしてください', 'warning');
  });

  // ── View modes ──
  /**
   * Parallel / Overlay mode on or off. Their layers are chosen anew each time (on entering Overlay mode,
   * ArchivePanel sets the selected image as U); leaving shows the ARCHIVES selection the Normal way.
   * The right sidebar closes / opens with these modes (the 100% size changes): 100% at both ends.
   */
  const toggleComparison = (enabled: boolean, layers: readonly ViewLayer[]) => {
    syncTextVisibility();
    if (!enabled) {
      clearLayers(layers);
      updateDrawSize(false);
    }
    zoom.resetTo100();
    updateLayout();
    redraw();
  };

  on('parallel-mode:toggle', ({ enabled }) => {
    state.parallel = enabled;
    if (!enabled) resetSliderOptions();
    toggleComparison(enabled, ['left', 'right']);
  });

  on('overlay-mode:toggle', ({ enabled }) => {
    state.overlay = enabled;
    setShown(overlayToolbar, enabled, 'flex');
    if (!enabled) {
      state.topOffset = { x: 0, y: 0 };
      state.topSelected = false;
    }
    toggleComparison(enabled, ['under', 'top']);
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
    if (isComparing(state)) return; // the selection is shown when the mode ends
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
  // Selections can change while a file loads: only the latest request is shown.
  let selectionRequest = 0;

  const showSelection = async (key: string, name: string) => {
    const request = ++selectionRequest;
    const isLatest = () => request === selectionRequest;
    const blob = await fetchArchiveKey(key);
    if (!isLatest()) return;
    if (!blob) return loadFailed(name);
    if (isTextBlob(name, blob)) {
      const text = await blob.text();
      if (!isLatest()) return;
      setText(text);
      state.selection.image = null;
      state.selection.summary = null;
      clearDocument(); // tools have no image while a text file is shown
      if (isComparing(state)) return; // only recorded: shown when the mode ends
      if (!canvases.left) initializeCanvases(800, 600);
      updateDrawSize(true);
      updateLayout();
      redraw();
      return;
    }
    const image = await blobToCanvas(blob);
    if (!isLatest()) return;
    if (!image) return loadFailed(name);
    setText(null);
    state.selection.image = image;
    state.selection.summary = null;
    // The save folder was already set by ArchivePanel (the file's parent folder).
    DocumentManager.getInstance().setCanvas(image, name, key); // emits document:loaded synchronously
    if (isComparing(state)) return;
    if (!canvases.left) initializeCanvases(image.width, image.height);
    updateDrawSize(false);
    zoom.resetTo100();
    updateLayout();
    redraw();
  };

  /** DocumentManager has no image now (tools see nothing). */
  const clearDocument = () => {
    state.docImage = null;
    DocumentManager.getInstance().setCanvas(null);
  };

  /** Shows nothing; `summary` (a folder / several entries selected) words the empty message. */
  const showNothing = (summary: SelectionSummary | null) => {
    selectionRequest++;
    state.selection.image = null;
    state.selection.summary = summary;
    setText(null);
    clearDocument();
    if (isComparing(state)) return;
    updateDrawSize(true);
    updateLayout();
    redraw();
  };

  const loadFailed = (name: string) => {
    showError(`「${name}」を読み込めませんでした`);
    showNothing(null);
  };

  on('archive:item-selected', ({ key, name }) => void showSelection(key, name));
  on('archive:selection-cleared', () => {
    state.batchImages = [];
    // Nothing selected -> no save folder either, so tools never write into the previous selection.
    DocumentManager.getInstance().setCurrentArchiveFolder(null);
    showNothing(null);
  });
  on('archive:selection-summary', summary => showNothing(summary));

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

  // ── Layers chosen with the ARCHIVES checkboxes (Parallel L / R, Overlay U / T) ──
  // Like selections, only the latest request of each layer is shown.
  const layerKeys: Record<ViewLayer, string | null> = { under: null, top: null, left: null, right: null };
  const layerRequest: Record<ViewLayer, number> = { under: 0, top: 0, left: 0, right: 0 };

  /**
   * Shows `key` as this layer (null clears it). An image that cannot be loaded is dropped and its checkbox
   * cleared; `quiet` (re-reading after the archives changed: it was deleted) does so without an error.
   */
  const loadLayer = async (layer: ViewLayer, key: string | null, name: string | null, quiet = false) => {
    const request = ++layerRequest[layer];
    const previousKey = layerKeys[layer];
    layerKeys[layer] = key;
    const image = key ? await loadArchiveCanvas(key) : null;
    if (request !== layerRequest[layer]) return;
    if (key && !image) {
      if (!quiet) showError(`「${name ?? key}」を読み込めませんでした`);
      emit('view:layer-selected', { layer, key: null, name: null });
      return;
    }
    state.layers[layer] = image;
    if (layer === 'top' && key !== previousKey) {
      // Another T starts centred again.
      state.topOffset = { x: 0, y: 0 };
      state.topSelected = false;
    }
    updateDrawSize(false); // 100% when the bounding box changed, else the zoom and position stay
    updateLayout();
    redraw();
  };

  const clearLayers = (layers: readonly ViewLayer[]) => {
    for (const layer of layers) {
      layerRequest[layer]++;
      layerKeys[layer] = null;
      state.layers[layer] = null;
    }
  };

  on('view:layer-selected', ({ layer, key, name }) => void loadLayer(layer, key, name));
  // Deleted (or restored) files: re-read the layers, dropping the ones that are gone.
  on('archives:changed', () => {
    for (const layer of LAYERS) {
      const key = layerKeys[layer];
      if (key) void loadLayer(layer, key, null, true);
    }
  });

  updateLayout();
  updateEmptyState();
  return main;
}

async function loadArchiveCanvas(key: string): Promise<HTMLCanvasElement | null> {
  const blob = await fetchArchiveKey(key);
  return blob ? blobToCanvas(blob) : null;
}
