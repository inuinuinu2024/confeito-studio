/**
 * Pan and zoom of the flow canvas: the world element (steps and edges, in layout pixels) is moved and
 * scaled with a CSS transform inside the fixed viewport. Also the zoom bar (bottom right).
 */
import { h, icon } from '../../shared/ui/dom';
import type { Rect } from './flow-layout';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;
const STEP = 1.2;
/** Fitting never enlarges past 100% nor shrinks below this (larger flows are scrolled instead). */
const FIT_MIN = 0.5;
const FIT_MARGIN = 24;
/** Room for the toolbar at the top left when fitting. */
const FIT_TOP = 64;

export interface PanZoom {
  bar: HTMLElement;
  /** Called by the zoom bar's 全体を表示 button. */
  onFitRequest: (() => void) | null;
  zoom(): number;
  /** Zooms by `factor` keeping the viewport point (`x`, `y`) in place (default: the centre). */
  zoomBy(factor: number, x?: number, y?: number): void;
  panBy(dx: number, dy: number): void;
  /** Shows `bounds` whole (at most 100%), or its top left at FIT_MIN when it is too large. */
  fit(bounds: Rect | null): void;
  /** Scrolls the least so that `rect` is in view (centred when it was out of view). */
  reveal(rect: Rect): void;
  /** Viewport client position -> world position. */
  toWorld(clientX: number, clientY: number): { x: number; y: number };
}

export function createPanZoom(viewport: HTMLElement, world: HTMLElement): PanZoom {
  let x = 0;
  let y = 0;
  let z = 1;
  const label = h('span', { class: 'canvas-zoom-bar__label', text: '100%' });

  const apply = () => {
    world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    label.textContent = `${Math.round(z * 100)}%`;
  };

  const zoomTo = (next: number, px: number, py: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    // The world point under (px, py) stays there.
    x = px - ((px - x) * clamped) / z;
    y = py - ((py - y) * clamped) / z;
    z = clamped;
    apply();
  };

  const zoomBy = (factor: number, px = viewport.clientWidth / 2, py = viewport.clientHeight / 2) =>
    zoomTo(z * factor, px, py);

  const fit = (bounds: Rect | null) => {
    if (!bounds || !bounds.w || !bounds.h) {
      x = y = 0;
      z = 1;
      return apply();
    }
    const vw = viewport.clientWidth - FIT_MARGIN * 2;
    const vh = viewport.clientHeight - FIT_TOP - FIT_MARGIN;
    const scale = Math.min(1, vw / bounds.w, vh / bounds.h);
    z = Math.max(FIT_MIN, scale);
    // Centred when it fits; otherwise from its top left.
    x = FIT_MARGIN + Math.max(0, (vw - bounds.w * z) / 2) - bounds.x * z;
    y = FIT_TOP + Math.max(0, (vh - bounds.h * z) / 2) - bounds.y * z;
    apply();
  };

  const reveal = (rect: Rect) => {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const left = rect.x * z + x;
    const top = rect.y * z + y;
    const inView = left >= 0 && top >= 0 && left + rect.w * z <= vw && top + rect.h * z <= vh;
    if (inView) return;
    x = vw / 2 - (rect.x + rect.w / 2) * z;
    y = vh / 2 - (rect.y + rect.h / 2) * z;
    apply();
  };

  const button = (title: string, iconName: string, onClick: () => void) =>
    h('button', { title, onclick: onClick }, icon(iconName, 16));
  const bar = h(
    'div',
    { class: 'canvas-zoom-bar flow-zoom-bar' },
    button('縮小', 'remove', () => zoomBy(1 / STEP)),
    label,
    button('拡大', 'add', () => zoomBy(STEP)),
    button('100%', 'crop_free', () => zoomTo(1, viewport.clientWidth / 2, viewport.clientHeight / 2)),
    button('全体を表示', 'fit_screen', () => api.onFitRequest?.()),
  );

  apply();
  const api: PanZoom = {
    bar,
    onFitRequest: null,
    zoom: () => z,
    zoomBy,
    panBy(dx, dy) {
      x += dx;
      y += dy;
      apply();
    },
    fit,
    reveal,
    toWorld(clientX, clientY) {
      const r = viewport.getBoundingClientRect();
      return { x: (clientX - r.left - x) / z, y: (clientY - r.top - y) / z };
    },
  };
  return api;
}
