/**
 * Canvas — the central viewing area: two panes (left/right) holding one <canvas> and one
 * text overlay each, the zoom bar, and the floating Compare / Overlay toolbars.
 *
 * Inputs (events):  archive:item-selected(:right), archive:selection-cleared(:right),
 *                   archive:batch-selected, overlay:underdrawing-selected(:right),
 *                   <mode>-mode:toggle, document:loaded/redraw, canvas:bg-color
 * Drawing:          render.ts (from CanvasState in canvas-state.ts)
 * Zoom:             zoom.ts
 * Image files dropped on the area are imported by running the image loader tool.
 */
import './canvas.css';
import { fetchArchiveKey } from '../../shared/api/archives';
import { IMAGE_FILE_PATTERN, TEXT_FILE_PATTERN } from '../../shared/config';
import { emit, on } from '../../shared/events';
import { h, icon, setShown } from '../../shared/ui/dom';
import { showToast } from '../../shared/ui/toast';
import { blobToCanvas } from '../../shared/utils/image';
import { runTool } from '../ai-panel/tool-runner';
import { DocumentManager } from '../document/DocumentManager';
import { importImageTool } from '../tools/image-loader';
import { type BatchImage, contentSize, createCanvasState, isTextActive, type Side } from './canvas-state';
import { batchGridSize, renderSide, topImageRect } from './render';
import { createCompareToolbar, createOverlayToolbar } from './toolbars';
import { createZoomController } from './zoom';

const isTextBlob = (name: string, blob: Blob) =>
  TEXT_FILE_PATTERN.test(name) || blob.type.startsWith('text/') || blob.type === 'application/json';

export function createCanvas(): HTMLElement {
  const state = createCanvasState();
  const canvases: Record<Side, HTMLCanvasElement | null> = { left: null, right: null };

  // ── DOM ──
  const main = h('main', { class: 'canvas-area' });
  const panels = {
    left: h('div', { class: 'canvas-split__panel' }),
    right: h('div', { class: 'canvas-split__panel' }),
  };
  const wrappers = {
    left: h('div', { class: 'canvas-split__content-wrapper' }),
    right: h('div', { class: 'canvas-split__content-wrapper' }),
  };
  const textOverlays = {
    left: h('div', { class: 'canvas-text-overlay' }),
    right: h('div', { class: 'canvas-text-overlay' }),
  };
  const divider = h(
    'div',
    { class: 'canvas-split__divider' },
    h('div', { class: 'canvas-split__divider-handle' }, icon('drag_indicator', 14)),
  );
  const inner = h('div', { class: 'canvas-split__inner' }, panels.left, divider, panels.right);
  const scrollArea = h('div', { class: 'canvas-split' }, inner);
  panels.left.append(wrappers.left);
  panels.right.append(wrappers.right);

  const zoom = createZoomController(state, scrollArea, inner);

  const compareToolbar = createCompareToolbar({
    onSlider: () => {
      if (!state.slider && !state.compare) return; // the slider compares the two Compare-mode panes
      state.slider = !state.slider;
      if (!state.slider) resetSliderOptions();
      compareToolbar.slider.set(state.slider);
      updateLayout();
    },
    onVertical: () => {
      state.vertical = !state.vertical;
      compareToolbar.vertical.set(state.vertical);
      updateLayout();
    },
    onFlip: () => {
      state.flipped = !state.flipped;
      compareToolbar.flip.set(state.flipped);
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
  const toolbar = h('div', { class: 'canvas-toolbar' }, compareToolbar.el, overlayToolbar);
  main.append(toolbar, zoom.bar, scrollArea);

  // ── Rendering ──
  function redraw(): void {
    for (const side of ['left', 'right'] as const) {
      const ctx = canvases[side]?.getContext('2d');
      if (ctx) renderSide(ctx, state, side);
    }
    updateTooltips();
  }

  function updateTooltips(): void {
    if (!canvases.left || !canvases.right) return;
    const size = (img: HTMLCanvasElement | null) => (img ? `${img.width} x ${img.height}px` : null);
    const fallback = `${state.drawW} x ${state.drawH}px`;
    const { left, right } = state.sides;
    canvases.left.title = (!state.overlay && state.compare && size(left.image)) || fallback;
    canvases.right.title = (!state.overlay && state.compare ? size(right.image) : size(left.image)) || fallback;
  }

  /** (Re)creates both canvases when the base size changes. */
  function initializeCanvases(width: number, height: number): void {
    if (canvases.left && canvases.right && state.baseW === width && state.baseH === height) return;
    state.baseW = state.drawW = width;
    state.baseH = state.drawH = height;
    for (const side of ['left', 'right'] as const) {
      const canvas = h('canvas', { class: 'canvas-split__canvas', width, height, title: `${width} x ${height}px` });
      canvases[side] = canvas;
      const ctx = canvas.getContext('2d');
      if (ctx) renderSide(ctx, state, side);
      wrappers[side].replaceChildren(canvas, textOverlays[side]);
      panels[side].replaceChildren(wrappers[side]);
    }
    updateTooltips();
  }

  /** Resizes the canvases to the content of the current mode and re-applies the zoom. */
  function updateDrawSize(fit: boolean): void {
    if (!state.compare && !state.slider && state.sides.left.text) {
      zoom.fitToScreen();
      return;
    }
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
    if (text !== null) textOverlays[side].textContent = text;
    textOverlays[side].style.display = text !== null ? 'block' : 'none';
  }

  function resetSliderOptions(): void {
    state.slider = state.vertical = state.flipped = false;
    compareToolbar.slider.set(false);
    compareToolbar.vertical.set(false);
    compareToolbar.flip.set(false);
  }

  /** The slider (wipe) view only exists in Compare mode. */
  function ensureSliderValid(): void {
    if (state.slider && !state.compare) {
      resetSliderOptions();
      updateLayout();
    }
  }

  function updateLayout(): void {
    const textActive = isTextActive(state);
    setShown(zoom.bar, !state.batch && !textActive, 'flex');
    if (textActive) Object.assign(inner.style, { width: '100%', height: '100%', margin: '0' });
    else zoom.apply(state.zoom, undefined, undefined, true);

    if (state.compare) {
      wrappers.left.append(textOverlays.left);
      wrappers.right.append(textOverlays.right);
    } else {
      wrappers.left.append(textOverlays.left);
    }

    setShown(compareToolbar.el, state.compare, 'flex');
    setShown(toolbar, state.compare || state.overlay, 'flex');
    compareToolbar.showSliderOptions(state.slider);

    const twoPanes = state.compare || state.slider;
    panels.right.style.display = twoPanes ? '' : 'none';
    divider.style.display = state.slider ? 'flex' : 'none';
    inner.style.gap = twoPanes && !state.slider ? '16px' : '0';
    inner.classList.toggle('canvas-split__inner--slider', state.slider);
    divider.classList.toggle('canvas-split__divider--vertical', state.slider && state.vertical);

    if (state.slider) {
      const front = state.flipped ? panels.right : panels.left;
      const back = state.flipped ? panels.left : panels.right;
      front.classList.add('canvas-split__panel--front');
      back.classList.remove('canvas-split__panel--front');
      back.style.clipPath = 'none';
      applySplit(front);
    } else {
      for (const panel of [panels.left, panels.right]) {
        panel.classList.remove('canvas-split__panel--front');
        panel.style.clipPath = 'none';
      }
      Object.assign(divider.style, { top: '', bottom: '', left: '', right: '', transform: '' });
    }
  }

  /** Clips the front pane at state.splitPct and moves the divider there. */
  function applySplit(front: HTMLElement): void {
    const pct = state.splitPct;
    if (state.vertical) {
      front.style.clipPath = `polygon(0 0, 100% 0, 100% ${pct}%, 0 ${pct}%)`;
      Object.assign(divider.style, {
        top: `${pct}%`,
        bottom: 'auto',
        left: '0',
        right: '0',
        transform: 'translateY(-50%)',
      });
    } else {
      front.style.clipPath = `polygon(0 0, ${pct}% 0, ${pct}% 100%, 0 100%)`;
      Object.assign(divider.style, {
        top: '0',
        bottom: '0',
        left: `${pct}%`,
        right: 'auto',
        transform: 'translateX(-50%)',
      });
    }
  }

  // ── Pointer interaction: pan, slider divider, Overlay T drag/select ──
  let pan: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;
  let draggingDivider = false;
  let topDrag: { side: Side; x: number; y: number; offsetX: number; offsetY: number } | null = null;

  /** Side under the pointer and the pointer position in canvas pixels (Overlay mode hit testing). */
  const canvasPoint = (e: MouseEvent) => {
    const side: Side =
      !state.compare || (e.target as HTMLElement).closest('.canvas-split__panel') === panels.left ? 'left' : 'right';
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

  scrollArea.addEventListener('mousedown', e => {
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
    pan = { x: e.clientX, y: e.clientY, scrollLeft: scrollArea.scrollLeft, scrollTop: scrollArea.scrollTop };
    document.body.style.cursor = 'grabbing';
    inner.style.transition = 'none';
  });

  scrollArea.addEventListener('dblclick', e => {
    if (!state.overlay || isControl(e.target)) return;
    const p = canvasPoint(e);
    if (p && hitsTop(p.side, p.x, p.y)) {
      state.sides[p.side].topSelected = !state.sides[p.side].topSelected;
      redraw();
    }
  });

  divider.addEventListener('mousedown', () => {
    draggingDivider = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', e => {
    if (draggingDivider) {
      const rect = inner.getBoundingClientRect();
      const pos = state.vertical ? (e.clientY - rect.top) / rect.height : (e.clientX - rect.left) / rect.width;
      state.splitPct = Math.max(0, Math.min(100, pos * 100));
      applySplit(state.flipped ? panels.right : panels.left);
    }
    if (pan) {
      scrollArea.scrollLeft = pan.scrollLeft + (pan.x - e.clientX);
      scrollArea.scrollTop = pan.scrollTop + (pan.y - e.clientY);
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
    for (const side of ['left', 'right'] as const) {
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
      const rect = scrollArea.getBoundingClientRect();
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
  on('compare-mode:toggle', ({ enabled }) => {
    state.compare = enabled;
    if (enabled) {
      state.sides.right.image = state.sides.left.image;
      const ctx = canvases.right?.getContext('2d');
      if (ctx) renderSide(ctx, state, 'right');
    } else if (state.slider) {
      resetSliderOptions();
    }
    updateLayout();
    redraw();
    ensureSliderValid();
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
    if (!enabled) state.batchImages = [];
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
  const showSelection = async (side: Side, key: string, name: string) => {
    const blob = await fetchArchiveKey(key);
    if (!blob) return;
    if (isTextBlob(name, blob)) {
      setText(side, await blob.text());
      state.sides[side].image = null;
      if (!canvases.left) initializeCanvases(800, 600);
      if (side === 'left') ensureSliderValid();
      updateDrawSize(true);
      updateLayout();
      redraw();
      return;
    }
    setText(side, null);
    const image = await blobToCanvas(blob);
    if (!image) return;
    state.sides[side].image = image;
    if (side === 'left') {
      const docManager = DocumentManager.getInstance();
      docManager.setCanvas(image, name, key); // emits document:loaded synchronously
      const archive = key.split('/');
      if (archive.length > 1) docManager.setCurrentArchiveFolder(archive[0]);
    }
    if (!canvases.left) initializeCanvases(image.width, image.height);
    updateDrawSize(false);
    zoom.resetTo100();
    updateLayout();
    redraw();
  };

  const clearSelection = (side: Side) => {
    state.sides[side].image = null;
    setText(side, null);
    if (side === 'left') {
      state.batchImages = [];
      const docManager = DocumentManager.getInstance();
      docManager.setCanvas(null);
      // Nothing selected -> no save folder either, so tools never write into the previous selection.
      docManager.setCurrentArchiveFolder(null);
    }
    updateDrawSize(true);
    updateLayout();
    redraw();
    if (side === 'left') ensureSliderValid();
  };

  on('archive:item-selected', ({ key, name }) => void showSelection('left', key, name));
  on('archive:item-selected:right', ({ key, name }) => void showSelection('right', key, name));
  on('archive:selection-cleared', () => clearSelection('left'));
  on('archive:selection-cleared:right', () => clearSelection('right'));

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
  return main;
}

async function loadArchiveCanvas(key: string | null): Promise<HTMLCanvasElement | null> {
  if (!key) return null;
  const blob = await fetchArchiveKey(key);
  return blob && blob.type.startsWith('image/') ? blobToCanvas(blob) : null;
}
