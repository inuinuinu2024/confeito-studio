/**
 * Zoom bar and zoom math for the canvas area.
 *
 * Zoom is relative to "fit": at 100% the canvas (state.drawW x drawH) is scaled to fit the
 * scroll area minus 64px padding; 10%–1000% multiplies that. Zooming keeps the point under
 * the cursor (or the centre) fixed by adjusting scroll offsets.
 *
 * The canvas always has free margins around it (viewport size minus KEEP_VISIBLE), so it can be
 * scrolled — dragged, wheeled or with the scrollbars — anywhere until only KEEP_VISIBLE px of an
 * edge remain, even when it is smaller than the viewport.
 */
import { h, icon } from '../../shared/ui/dom';
import { type CanvasState, isTextActive } from './canvas-state';

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
  /** Largest zoom (≤100%) that shows the whole canvas, centred. */
  fitToScreen(): void;
  /** Zoom by ±STEP around a point of the scroll area (Ctrl + wheel). */
  zoomBy(direction: 1 | -1, focusX?: number, focusY?: number): void;
}

export function createZoomController(state: CanvasState, scrollArea: HTMLElement, inner: HTMLElement): ZoomController {
  const slider = h('input', { type: 'range', min: String(MIN_ZOOM), max: String(MAX_ZOOM), value: '100' });
  const label = h('span', { class: 'canvas-zoom-bar__label', text: '100%' });

  const fillInner = () => {
    Object.assign(inner.style, {
      width: '100%',
      height: '100%',
      marginTop: '0',
      marginBottom: '0',
      marginLeft: '0',
      marginRight: '0',
    });
  };

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
  };

  function apply(previousZoom: number, focusX?: number, focusY?: number, force = false): void {
    if (isTextActive(state)) {
      fillInner();
      return;
    }
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
      Object.assign(inner.style, {
        width: `${renderW}px`,
        height: `${renderH}px`,
        marginTop: marginY,
        marginBottom: marginY,
        marginLeft: marginX,
        marginRight: marginX,
      });
    }
    // offsetLeft/Top: position inside the scrolled content (scrollArea is the offset parent).
    scrollArea.scrollLeft = inner.offsetLeft + contentX * ratio - cx;
    scrollArea.scrollTop = inner.offsetTop + contentY * ratio - cy;
  }

  const setZoom = (zoom: number, focusX?: number, focusY?: number, force = false) => {
    const previous = state.zoom;
    state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    apply(previous, focusX, focusY, force);
  };

  const resetScroll = () => {
    scrollArea.scrollLeft = 0;
    scrollArea.scrollTop = 0;
  };

  function resetTo100(): void {
    if (isTextActive(state)) {
      fillInner();
      resetScroll();
      return;
    }
    setZoom(100, undefined, undefined, true);
    setTimeout(() => align('top'), 0);
  }

  function fitToScreen(): void {
    if (isTextActive(state)) {
      fillInner();
      resetScroll();
      return;
    }
    if (!state.drawW || !state.drawH) return;
    setZoom(Math.min(100, Math.floor(baseScale().scale * 100)), undefined, undefined, true);
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
  // Window / sidebar resizes change the 100% size and the free margins.
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

  return { bar, apply, resetTo100, fitToScreen, zoomBy };
}
