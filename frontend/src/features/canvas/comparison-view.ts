/**
 * The comparison view of Parallel / Overlay (docs/specs/canvas.md): two panes (left/right) holding a scrolling
 * viewport with one <canvas> and an empty-pane notice each, the zoom bar, and the floating Parallel / Overlay
 * toolbars. The comparison window opened from a generated image on the flow canvas (compare-window.ts) shows it
 * and says which images to show in which mode.
 *
 * The panes are fixed frames: side by side in Parallel mode (a 1px boundary between them), stacked
 * with the front one clipped at a screen-fixed divider in the slider view, and only the left one in
 * Overlay mode. Pan and zoom move the images inside both panes together (zoom.ts).
 *
 * Drawing:          render.ts (from CanvasState in canvas-state.ts)
 * Zoom / scroll:    zoom.ts
 * Nothing to show:  a centred message (EmptyMessages; per pane in Parallel mode).
 */
import './canvas.css';
import { fetchArchiveKey } from '../../shared/api/archives';
import type { FlowImage } from '../../shared/types/flow';
import { h, icon, setShown } from '../../shared/ui/dom';
import { showError } from '../../shared/ui/toast';
import { blobToCanvas } from '../../shared/utils/image';
import {
  type CanvasState,
  contentSize,
  createCanvasState,
  type EmptyMessages,
  emptyCanvasMessage,
  emptyPaneMessage,
  isComparing,
  type Side,
  sliderClip,
  type ViewLayer,
} from './canvas-state';
import { renderSide, topImageRect } from './render';
import { createOverlayToolbar, createSliderToolbar } from './toolbars';
import { createZoomController } from './zoom';

/** Side by side, stacked with a divider (the slider view of the two Parallel panes), or one over the other. */
export type CompareMode = 'parallel' | 'slider' | 'overlay';

const SIDES = ['left', 'right'] as const;
const LAYERS = ['under', 'top', 'left', 'right'] as const;
const MODE_LAYERS: Record<CompareMode, readonly [ViewLayer, ViewLayer]> = {
  parallel: ['left', 'right'],
  slider: ['left', 'right'],
  overlay: ['under', 'top'],
};

export interface ComparisonViewOptions {
  /** Messages where an image is missing (it could not be read). */
  messages: EmptyMessages;
}

export interface ComparisonView {
  /** The comparison area (`.canvas-area`). */
  el: HTMLElement;
  mode(): CompareMode | null;
  /**
   * Shows `images` (the first two: L / R in Parallel and Slider, U / T in Overlay) in `mode`, at 100%.
   * Leaving Slider turns Transpose / Flip off and centres the divider, leaving Overlay puts T back.
   */
  show(mode: CompareMode, images: readonly (FlowImage | null)[]): void;
  setBgColor(color: string): void;
  /** Stops listening to the window and the resizes (a view that is thrown away). */
  destroy(): void;
}

export function createComparisonView({ messages }: ComparisonViewOptions): ComparisonView {
  const state: CanvasState = createCanvasState();
  const canvases: Record<Side, HTMLCanvasElement | null> = { left: null, right: null };
  /** Listeners on window / document, removed by destroy(). */
  const listening = new AbortController();
  const { signal } = listening;

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
  const emptyState = h('div', { class: 'canvas-empty' }, icon('image', 48), emptyMessage);

  const sliderToolbar = createSliderToolbar({
    onVertical: () => {
      state.vertical = !state.vertical;
      sliderToolbar.vertical.set(state.vertical);
      updateLayout();
    },
    onFlip: () => {
      state.flipped = !state.flipped;
      sliderToolbar.flip.set(state.flipped);
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
  const toolbar = h('div', { class: 'canvas-toolbar' }, sliderToolbar.el, overlayToolbar);
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
    const message = emptyCanvasMessage(state, messages);
    if (message !== null) emptyMessage.textContent = message;
    setShown(emptyState, message !== null, 'flex');
    for (const side of SIDES) {
      const paneMessage = emptyPaneMessage(state, side, messages);
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

  function resetSliderOptions(): void {
    state.vertical = state.flipped = false;
    state.splitPct = 50;
    sliderToolbar.vertical.set(false);
    sliderToolbar.flip.set(false);
  }

  function updateLayout(): void {
    setShown(zoom.bar, isComparing(state), 'flex');
    setShown(sliderToolbar.el, state.slider, 'flex');
    setShown(overlayToolbar, state.overlay, 'flex');
    setShown(toolbar, state.slider || state.overlay, 'flex'); // Parallel has no options

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
    if (isControl(e.target)) return;
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

  window.addEventListener(
    'mousemove',
    e => {
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
    },
    { signal },
  );

  const endDrag = () => {
    if (draggingDivider || pan || topDrag) document.body.style.cursor = '';
    if (draggingDivider) document.body.style.userSelect = '';
    draggingDivider = false;
    pan = null;
    topDrag = null;
  };
  window.addEventListener('mouseup', endDrag, { signal });

  // Overlay mode: arrow keys move the selected T (Shift = 10px). Otherwise they scroll as usual.
  const isEditable = (target: EventTarget | null) =>
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);
  window.addEventListener(
    'keydown',
    e => {
      if (!state.overlay || !state.topSelected || !state.layers.top || isEditable(e.target)) return;
      const step = e.shiftKey ? 10 : 1;
      const delta = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key];
      if (!delta) return;
      state.topOffset = { x: state.topOffset.x + delta[0], y: state.topOffset.y + delta[1] };
      redraw();
      e.preventDefault();
    },
    { signal },
  );

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

  // ── The compared images (Parallel L / R, Overlay U / T) ──
  // Only the latest request of each layer is shown.
  const layerRequest: Record<ViewLayer, number> = { under: 0, top: 0, left: 0, right: 0 };
  /** Decoded images by key (switching modes does not read them again). */
  const decoded = new Map<string, Promise<HTMLCanvasElement | null>>();

  const loadArchiveCanvas = (key: string): Promise<HTMLCanvasElement | null> => {
    let pending = decoded.get(key);
    if (!pending) {
      const request = fetchArchiveKey(key)
        .then(blob => (blob ? blobToCanvas(blob) : null))
        .catch(() => null);
      decoded.set(key, request);
      // A failure is not remembered: the next request tries again.
      void request.then(canvas => {
        if (!canvas && decoded.get(key) === request) decoded.delete(key);
      });
      pending = request;
    }
    return pending;
  };

  /** Shows `image` as this layer (null clears it). An image that cannot be loaded is dropped with an error. */
  const loadLayer = async (layer: ViewLayer, image: FlowImage | null) => {
    const request = ++layerRequest[layer];
    const canvas = image ? await loadArchiveCanvas(image.key) : null;
    if (request !== layerRequest[layer]) return;
    if (image && !canvas) showError(`「${image.name}」を読み込めませんでした`);
    state.layers[layer] = canvas;
    if (layer === 'top') {
      // Another T starts centred again.
      state.topOffset = { x: 0, y: 0 };
      state.topSelected = false;
    }
    updateDrawSize(false); // 100% when the bounding box changed, else the zoom and position stay
    updateLayout();
    redraw();
  };

  const clearLayers = () => {
    for (const layer of LAYERS) {
      layerRequest[layer]++;
      state.layers[layer] = null;
    }
  };

  const currentMode = (): CompareMode | null =>
    state.overlay ? 'overlay' : state.slider ? 'slider' : state.parallel ? 'parallel' : null;

  function show(mode: CompareMode, images: readonly (FlowImage | null)[]): void {
    const previous = currentMode();
    if (previous === 'slider' && mode !== 'slider') resetSliderOptions();
    if (previous === 'overlay' && mode !== 'overlay') {
      state.topOffset = { x: 0, y: 0 };
      state.topSelected = false;
    }
    // Slider shows the two Parallel panes stacked.
    state.parallel = mode === 'parallel' || mode === 'slider';
    state.slider = mode === 'slider';
    state.overlay = mode === 'overlay';
    clearLayers();
    MODE_LAYERS[mode].forEach((layer, i) => void loadLayer(layer, images[i] ?? null));
    zoom.resetTo100();
    updateLayout();
    redraw();
  }

  updateLayout();
  updateEmptyState();
  return {
    el: main,
    mode: currentMode,
    show,
    setBgColor(color) {
      state.bgColor = color;
      redraw();
    },
    destroy() {
      listening.abort();
      endDrag();
      zoom.destroy();
      clearLayers();
      decoded.clear();
    },
  };
}
