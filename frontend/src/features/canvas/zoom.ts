/**
 * Zoom bar and zoom math for the canvas area.
 *
 * Zoom is relative to "fit": at 100% the canvas (state.drawW x drawH) is scaled to fit one pane's
 * viewport minus 64px padding; 10%–1000% multiplies that. Zooming keeps the point under the cursor
 * (or the centre) fixed by adjusting scroll offsets.
 *
 * The canvas always has free margins around it (viewport size minus KEEP_VISIBLE), so it can be
 * scrolled — dragged, wheeled or with the scrollbars — anywhere until only KEEP_VISIBLE px of an
 * edge remain, even when it is smaller than the viewport.
 *
 * Parallel mode has two panes (fixed frames). Both inners get the same size, computed from the left
 * viewport (always shown), and their scroll positions are kept equal, so pan and zoom apply to both.
 */
import { h, icon } from '../../shared/ui/dom';
import type { CanvasState, Side } from './canvas-state';

const MIN_ZOOM = 10;
const MAX_ZOOM = 1000;
const STEP = 10;
const PADDING = 64;
/** Pixels of the canvas that stay on screen however far it is moved. */
const KEEP_VISIBLE = 64;

export interface ZoomController {
  bar: HTMLDivElement;
  /** Re-applies the inner size for state.zoom (call after size or layout changes). */
  apply(previousZoom: number, focusX?: number, focusY?: number, force?: boolean): void;
  /** Zoom 100%: centred horizontally; vertically centred if it fits, else its top shown. */
  resetTo100(): void;
  /** Largest zoom that shows the whole canvas (= 100%, the fit size), centred. */
  fitToScreen(): void;
  /** Zoom by ±STEP around a point of the pane viewport (Ctrl + wheel). */
  zoomBy(direction: 1 | -1, focusX?: number, focusY?: number): void;
  /** Copies the scroll position of this pane's viewport to the other pane (call after scrolling it). */
  syncScroll(from: HTMLElement): void;
  /** Runs a layout change that resizes the panes, keeping the point at the centre of the view and the zoom. */
  relayout(change: () => void): void;
}

/** One pane: its scrolling viewport and the zoomed element inside it. */
export interface ZoomPane {
  viewport: HTMLElement;
  inner: HTMLElement;
}

export function createZoomController(state: CanvasState, panes: Record<Side, ZoomPane>): ZoomController {
  const slider = h('input', { type: 'range', min: String(MIN_ZOOM), max: String(MAX_ZOOM), value: '100' });
  const label = h('span', { class: 'canvas-zoom-bar__label', text: '100%' });
  // The left pane is always shown: sizes and scroll positions are computed on it.
  const { viewport: scrollArea, inner } = panes.left;

  /** Copies the scroll position of `from` to the other pane. */
  const syncScroll = (from: HTMLElement) => {
    const to = from === panes.left.viewport ? panes.right.viewport : panes.left.viewport;
    if (to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
    if (to.scrollTop !== from.scrollTop) to.scrollTop = from.scrollTop;
  };
  for (const { viewport } of [panes.left, panes.right]) {
    viewport.addEventListener('scroll', () => syncScroll(viewport));
  }

  const baseScale = () => {
    const availableW = Math.max(1, scrollArea.clientWidth - PADDING);
    const availableH = Math.max(1, scrollArea.clientHeight - PADDING);
    return { availableW, availableH, scale: Math.min(availableW / state.drawW, availableH / state.drawH) };
  };

  /** Margin on each side so the canvas can move until KEEP_VISIBLE px remain (scroll area padding = PADDING / 2). */
  const freeMargin = (viewport: number) => `${Math.max(0, viewport - KEEP_VISIBLE - PADDING / 2)}px`;

  /** Centres the canvas horizontally; vertically centres it, or (top) shows its top edge when it is taller. */
  const align = (vertical: 'center' | 'top') => {
    const freeH = (scrollArea.clientHeight - inner.offsetHeight) / 2;
    scrollArea.scrollLeft = inner.offsetLeft - (scrollArea.clientWidth - inner.offsetWidth) / 2;
    scrollArea.scrollTop = inner.offsetTop - (vertical === 'center' ? freeH : Math.max(PADDING / 2, freeH));
    syncScroll(scrollArea);
  };

  function apply(previousZoom: number, focusX?: number, focusY?: number, force = false): void {
    if (previousZoom === state.zoom && !force) return;

    slider.value = String(state.zoom);
    label.textContent = `${state.zoom}%`;

    const innerRect = inner.getBoundingClientRect();
    const areaRect = scrollArea.getBoundingClientRect();
    const cx = focusX ?? areaRect.width / 2;
    const cy = focusY ?? areaRect.height / 2;
    const contentX = areaRect.left + cx - innerRect.left;
    const contentY = areaRect.top + cy - innerRect.top;
    let ratio = state.zoom / previousZoom;

    if (state.drawW && state.drawH) {
      const { scale } = baseScale();
      const renderW = Math.round(state.drawW * scale * (state.zoom / 100));
      const renderH = Math.round(state.drawH * scale * (state.zoom / 100));
      // The 100% size also changes when the viewport is resized: scale by the real size change.
      if (innerRect.width > 0) ratio = renderW / innerRect.width;
      const marginX = freeMargin(scrollArea.clientWidth);
      const marginY = freeMargin(scrollArea.clientHeight);
      for (const pane of [panes.left, panes.right]) {
        Object.assign(pane.inner.style, {
          width: `${renderW}px`,
          height: `${renderH}px`,
          marginTop: marginY,
          marginBottom: marginY,
          marginLeft: marginX,
          marginRight: marginX,
        });
      }
    }
    // offsetLeft/Top: position inside the scrolled content (the viewport is the offset parent).
    scrollArea.scrollLeft = inner.offsetLeft + contentX * ratio - cx;
    scrollArea.scrollTop = inner.offsetTop + contentY * ratio - cy;
    syncScroll(scrollArea);
  }

  function relayout(change: () => void): void {
    // Measured before the change: the pane size (and the 100% size) changes with it.
    const w = inner.offsetWidth;
    const hh = inner.offsetHeight;
    const fx = w ? (scrollArea.scrollLeft + scrollArea.clientWidth / 2 - inner.offsetLeft) / w : 0.5;
    const fy = hh ? (scrollArea.scrollTop + scrollArea.clientHeight / 2 - inner.offsetTop) / hh : 0.5;
    change();
    apply(state.zoom, undefined, undefined, true);
    scrollArea.scrollLeft = inner.offsetLeft + fx * inner.offsetWidth - scrollArea.clientWidth / 2;
    scrollArea.scrollTop = inner.offsetTop + fy * inner.offsetHeight - scrollArea.clientHeight / 2;
    syncScroll(scrollArea);
  }

  const setZoom = (zoom: number, focusX?: number, focusY?: number, force = false) => {
    const previous = state.zoom;
    state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    apply(previous, focusX, focusY, force);
  };

  function resetTo100(): void {
    setZoom(100, undefined, undefined, true);
    setTimeout(() => align('top'), 0);
  }

  function fitToScreen(): void {
    if (!state.drawW || !state.drawH) return;
    setZoom(100, undefined, undefined, true); // 100% is the fit size
    setTimeout(() => align('center'), 0);
  }

  /** Canvas width fills the area (may exceed 100%); scrolled to the top. */
  function fitWidth(): void {
    if (!state.drawW || !state.drawH) return;
    const { availableW, scale } = baseScale();
    setZoom(Math.floor((100 * availableW) / (state.drawW * scale)), undefined, undefined, true);
    setTimeout(() => align('top'), 0);
  }

  function fitHeight(): void {
    if (!state.drawW || !state.drawH) return;
    const { availableH, scale } = baseScale();
    setZoom(Math.floor((100 * availableH) / (state.drawH * scale)), undefined, undefined, true);
    setTimeout(() => align('center'), 0);
  }

  const zoomBy = (direction: 1 | -1, focusX?: number, focusY?: number) =>
    setZoom(state.zoom + direction * STEP, focusX, focusY);

  slider.addEventListener('input', () => setZoom(parseInt(slider.value, 10)));
  // Window / sidebar resizes (and the Parallel panes appearing) change the 100% size and the free margins.
  new ResizeObserver(() => apply(state.zoom, undefined, undefined, true)).observe(scrollArea);

  const button = (content: string | HTMLElement, title: string, onClick: () => void) =>
    h('button', { title, onclick: onClick }, content);

  const bar = h(
    'div',
    { class: 'canvas-zoom-bar' },
    button('-', 'Zoom Out', () => zoomBy(-1)),
    slider,
    button('+', 'Zoom In', () => zoomBy(1)),
    label,
    button(icon('fit_screen', 16), 'Fit to Screen', fitToScreen),
    button(icon('width', 16), 'Fit Width', fitWidth),
    button(icon('height', 16), 'Fit Height', fitHeight),
    button(icon('home', 16), 'Zoom 100%', resetTo100),
  );

  return { bar, apply, resetTo100, fitToScreen, zoomBy, syncScroll, relayout };
}
