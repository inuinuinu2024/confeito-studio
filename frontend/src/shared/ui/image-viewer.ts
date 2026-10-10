/**
 * A window in the app that shows one image large, only to look at it (docs/specs/flow-canvas.md 「拡大表示」).
 * It opens fitted to the window (small images enlarged too); the wheel zooms around the cursor, dragging moves the image, the buttons
 * fit it / show it at 100% (actual pixels), and a double click switches between the two.
 * It is a 別ウィンドウ (shared/ui/window.ts): ×, Esc and a click outside the window close it; nothing else changes.
 * Styles: shared/styles/components.css (cs-image-viewer).
 */
import { h, icon } from './dom';
import { openWindow } from './window';

const MIN_SCALE = 0.05;
const MAX_SCALE = 16;
const WHEEL_STEP = 1.15;
const FIT_PADDING = 16;

export interface ImageViewerOptions {
  /** Shown after the title (e.g. "1600 × 1200 px"). */
  subtitle?: string;
  /** With it, a download button in the header calls it (saving the image is the caller's job). */
  onDownload?: () => void;
  /** Called once the window is closed (e.g. to revoke the object URL of `src`). */
  onClose?: () => void;
}

export function openImageViewer(src: string, title: string, options: ImageViewerOptions = {}): void {
  const img = h('img', { class: 'cs-image-viewer__img', src, alt: title, draggable: false });
  const stage = h('div', { class: 'cs-image-viewer__body' }, img);
  const zoomLabel = h('span', { class: 'cs-image-viewer__zoom', text: '' });
  const tool = (label: string, iconName: string, onClick: () => void) =>
    h('button', { class: 'cs-image-viewer__tool', title: label, onclick: onClick }, icon(iconName, 18));
  const win = openWindow({
    title,
    className: 'cs-image-viewer',
    headerTools: [
      options.subtitle ? h('span', { class: 'cs-image-viewer__subtitle', text: options.subtitle }) : null,
      tool('縮小', 'remove', () => zoomAround(scale / WHEEL_STEP)),
      zoomLabel,
      tool('拡大', 'add', () => zoomAround(scale * WHEEL_STEP)),
      tool('全体を表示', 'fit_screen', () => fit()),
      tool('100%（実寸）', 'crop_free', () => zoomAround(1)),
      options.onDownload ? tool('この画像を書き出す（ダウンロード）', 'download', options.onDownload) : null,
    ],
    onClose: () => {
      resizeObserver.disconnect();
      options.onClose?.();
    },
  });
  win.body.append(stage);

  // ── Zoom and position: the image's top left at (x, y) in the stage, `scale` screen px per image px ──
  let x = 0;
  let y = 0;
  let scale = 1;
  let fitted = true;
  const apply = () => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  };
  const fitScale = () => {
    const w = img.naturalWidth || 1;
    const hgt = img.naturalHeight || 1;
    return Math.min((stage.clientWidth - FIT_PADDING * 2) / w, (stage.clientHeight - FIT_PADDING * 2) / hgt);
  };
  const fit = () => {
    scale = Math.max(MIN_SCALE, fitScale());
    x = (stage.clientWidth - img.naturalWidth * scale) / 2;
    y = (stage.clientHeight - img.naturalHeight * scale) / 2;
    fitted = true;
    apply();
  };
  /** Zooms to `next` keeping the stage point (px, py) in place (default: the centre). */
  const zoomAround = (next: number, px = stage.clientWidth / 2, py = stage.clientHeight / 2) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    x = px - ((px - x) * clamped) / scale;
    y = py - ((py - y) * clamped) / scale;
    scale = clamped;
    fitted = false;
    apply();
  };
  const stagePoint = (e: MouseEvent) => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  stage.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      zoomAround(e.deltaY < 0 ? scale * WHEEL_STEP : scale / WHEEL_STEP, ...stagePoint(e));
    },
    { passive: false },
  );
  stage.addEventListener('dblclick', e => {
    if (fitted) zoomAround(1, ...stagePoint(e));
    else fit();
  });
  let drag: { x: number; y: number; startX: number; startY: number } | null = null;
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, startX: x, startY: y };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('cs-image-viewer__body--dragging');
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    x = drag.startX + e.clientX - drag.x;
    y = drag.startY + e.clientY - drag.y;
    fitted = false;
    apply();
  });
  const endDrag = () => {
    drag = null;
    stage.classList.remove('cs-image-viewer__body--dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // Keep the fitted view when the window is resized.
  const resizeObserver = new ResizeObserver(() => {
    if (fitted && img.naturalWidth) fit();
  });
  img.addEventListener('load', () => fit(), { once: true });

  resizeObserver.observe(stage);
  if (img.complete && img.naturalWidth) fit();
}
