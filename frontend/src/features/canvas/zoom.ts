/**
 * Zoom bar and zoom math for the canvas area.
 *
 * Zoom is relative to "fit": at 100% the canvas (state.drawW x drawH) is scaled to fit the
 * scroll area minus 64px padding; 10%–1000% multiplies that. Zooming keeps the point under
 * the cursor (or the centre) fixed by adjusting scroll offsets.
 */
import { h, icon } from '../../shared/ui/dom';
import { type CanvasState, isTextActive } from './canvas-state';

const MIN_ZOOM = 10;
const MAX_ZOOM = 1000;
const STEP = 10;
const PADDING = 64;

export interface ZoomController {
  bar: HTMLDivElement;
  /** Re-applies the inner size for state.zoom (call after size or layout changes). */
  apply(previousZoom: number, focusX?: number, focusY?: number, force?: boolean): void;
  /** Zoom 100%: centred horizontally, scrolled to the top. */
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
    return { availableH, scale: Math.min(availableW / state.drawW, availableH / state.drawH) };
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
    const ratio = state.zoom / previousZoom;

    if (state.drawW && state.drawH) {
      const { scale } = baseScale();
      const renderW = Math.round(state.drawW * scale * (state.zoom / 100));
      const renderH = Math.round(state.drawH * scale * (state.zoom / 100));
      const vertical = renderH > scrollArea.clientHeight ? '0' : 'auto';
      const horizontal = renderW > scrollArea.clientWidth ? '0' : 'auto';
      Object.assign(inner.style, {
        width: `${renderW}px`,
        height: `${renderH}px`,
        marginTop: vertical,
        marginBottom: vertical,
        marginLeft: horizontal,
        marginRight: horizontal,
      });
    }
    scrollArea.scrollLeft = contentX * ratio - cx;
    scrollArea.scrollTop = contentY * ratio - cy;
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
    setTimeout(() => {
      scrollArea.scrollLeft = Math.max(0, (scrollArea.scrollWidth - scrollArea.clientWidth) / 2);
      scrollArea.scrollTop = 0;
    }, 0);
  }

  const centerScroll = () => {
    scrollArea.scrollLeft = (scrollArea.scrollWidth - scrollArea.clientWidth) / 2;
    scrollArea.scrollTop = (scrollArea.scrollHeight - scrollArea.clientHeight) / 2;
  };

  function fitToScreen(): void {
    if (isTextActive(state)) {
      fillInner();
      resetScroll();
      return;
    }
    if (!state.drawW || !state.drawH) return;
    setZoom(Math.min(100, Math.floor(baseScale().scale * 100)), undefined, undefined, true);
    setTimeout(centerScroll, 0);
  }

  function fitHeight(): void {
    if (!state.drawW || !state.drawH) return;
    const { availableH, scale } = baseScale();
    setZoom(Math.floor((100 * availableH) / (state.drawH * scale)), undefined, undefined, true);
    centerScroll();
  }

  const zoomBy = (direction: 1 | -1, focusX?: number, focusY?: number) =>
    setZoom(state.zoom + direction * STEP, focusX, focusY);

  slider.addEventListener('input', () => setZoom(parseInt(slider.value, 10)));

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
    button(icon('height', 16), 'Fit Height', fitHeight),
    button(icon('home', 16), 'Zoom 100%', resetTo100),
  );

  return { bar, apply, resetTo100, fitToScreen, zoomBy };
}
