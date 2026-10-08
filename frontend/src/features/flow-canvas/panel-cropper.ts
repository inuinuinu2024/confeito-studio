/**
 * コマの切り直し (docs/specs/flow-canvas.md 「コマの切り直し」): opened by a click on the 原画 of a panel's row.
 * Left: the page before the split, with the frame where the shown version of the panel was cut (the rest is
 * dimmed). The frame moves by dragging and resizes by its corners and edges; once moved, the shown version's
 * box stays as a dashed outline. The page opens fitted; the wheel zooms around the cursor, dragging the page
 * (outside the frame) moves it, a double click switches between fitted and 100%, and the toolbar has −, the
 * zoom, ＋, コマに合わせる and 全体を表示. Right: the cut as it would be, its box, 「この範囲で切り出し直す」 (saves a new
 * version, shown at once) and コマ割りの履歴 (the versions, newest first): a click shows that version in the
 * Workspace with what was made from it. A 別ウィンドウ (shared/ui/window.ts): ×, Esc and a click outside close it.
 */
import { fetchArchiveKey } from '../../shared/api/archives';
import { h, icon } from '../../shared/ui/dom';
import { button } from '../../shared/ui/form';
import { openWindow } from '../../shared/ui/window';
import { describeError } from '../../shared/utils/error-message';
import {
  type Box,
  boxOfRect,
  HANDLES,
  type Handle,
  moveRect,
  type Rect,
  rectOfBox,
  resizeRect,
  sameBox,
} from '../../shared/utils/rect-crop';

/** Long side of the preview's pixels (CSS fits it into the right half of the window). */
const PREVIEW_MAX = 1200;
const MIN_SCALE = 0.05;
const MAX_SCALE = 16;
const WHEEL_STEP = 1.15;
const FIT_PADDING = 12;
/** Room around the frame for コマに合わせる, relative to the frame. */
const FOCUS_MARGIN = 0.15;

/** One version of the panel, as listed in コマ割りの履歴. */
export interface CropperVersion {
  /** "分割時" / "切り直し <n>" */
  label: string;
  /** "YYYY-MM-DD HH:MM:SS" */
  createdAt: string;
  /** Where it was cut on the page. */
  box: Box;
}

export interface PanelCropperHost {
  /** "コマ #2 — 02.png" */
  title: string;
  /** The page before the split. */
  loadPage(): Promise<Blob | null>;
  /** The versions (oldest first) and the index of the shown one; read again after every change (null: gone). */
  state(): { versions: CropperVersion[]; shown: number } | null;
  /** Shows version `index` in the Workspace (saved in the archive). */
  pick(index: number): Promise<void>;
  /** Cuts the panel again with `box`; resolves false when it failed (the host reports why). */
  recrop(box: Box): Promise<boolean>;
}

/** `pixel_box` of `filename` in `<splitFolder>/panels.json`, or null when it is missing or broken. */
export async function panelBoxOf(splitFolder: string, filename: string): Promise<Box | null> {
  const blob = await fetchArchiveKey(`${splitFolder}/panels.json`);
  if (!blob) return null;
  try {
    const data = JSON.parse(await blob.text()) as { panels?: { filename?: string; pixel_box?: unknown }[] };
    const box = data.panels?.find(p => p.filename === filename)?.pixel_box;
    return Array.isArray(box) && box.length === 4 && box.every(v => typeof v === 'number') ? (box as Box) : null;
  } catch {
    return null;
  }
}

const sizeOf = ([xmin, ymin, xmax, ymax]: Box) => `${xmax - xmin} × ${ymax - ymin}`;

export function openPanelCropper(host: PanelCropperHost): void {
  let objectUrl: string | null = null;
  const win = openWindow({
    title: host.title,
    className: 'panel-cropper',
    onClose: () => {
      resizeObserver.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
  });

  let state = host.state();
  let naturalWidth = 0;
  let naturalHeight = 0;
  // The view: the page's top left at (viewX, viewY) in the stage, `scale` screen px per page px.
  let viewX = 0;
  let viewY = 0;
  let scale = 1;
  let fitted = true;
  let rect: Rect | null = null;
  let busy = false;

  const img = h('img', { class: 'panel-cropper__image', alt: '', draggable: false });
  const current = h('div', { class: 'panel-cropper__current', title: '表示中の版の範囲' });
  const frame = h(
    'div',
    { class: 'panel-cropper__frame', title: 'ドラッグで移動、四隅と四辺で大きさを変更' },
    ...HANDLES.map(handle =>
      h('div', { class: `panel-cropper__handle panel-cropper__handle--${handle}`, dataset: { handle } }),
    ),
  );
  const canvasArea = h('div', { class: 'panel-cropper__canvas' }, img, current, frame);
  const stage = h('div', { class: 'panel-cropper__stage' }, canvasArea);
  const zoomLabel = h('span', { class: 'panel-cropper__zoom' });
  const tool = (label: string, iconName: string, onClick: () => void) =>
    h('button', { class: 'panel-cropper__tool', title: label, onclick: onClick }, icon(iconName, 18));
  const toolbar = h(
    'div',
    { class: 'panel-cropper__toolbar' },
    tool('縮小', 'remove', () => zoomAround(scale / WHEEL_STEP)),
    zoomLabel,
    tool('拡大', 'add', () => zoomAround(scale * WHEEL_STEP)),
    tool('コマに合わせる', 'center_focus_strong', () => focusFrame()),
    tool('全体を表示', 'crop_free', () => fit()),
  );
  const preview = h('canvas', { class: 'panel-cropper__preview', width: 1, height: 1 });
  const resetButton = button('表示中の範囲に戻す', () => resetFrame(), { variant: 'outline', size: 'small' });
  const recropButton = button('この範囲で切り出し直す', () => void recrop(), { variant: 'primary', block: true });
  const history = h('div', { class: 'panel-cropper__versions', attrs: { role: 'list' } });
  const status = h('div', { class: 'panel-cropper__status' });

  win.body.append(
    h(
      'div',
      { class: 'panel-cropper__body' },
      h('div', { class: 'panel-cropper__left' }, toolbar, stage),
      h(
        'div',
        { class: 'panel-cropper__side' },
        h('div', { class: 'panel-cropper__preview-box' }, preview),
        h('div', { class: 'panel-cropper__buttons' }, resetButton),
        recropButton,
        h('div', { class: 'cs-field__label panel-cropper__history-label', text: 'コマ割りの履歴' }),
        history,
      ),
    ),
    status,
  );

  const px = (value: number) => `${value * scale}px`;
  const shownBox = (): Box | null => state?.versions[state.shown]?.box ?? null;
  const place = (el: HTMLElement, r: Rect) =>
    Object.assign(el.style, { left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) });

  function render(): void {
    const ready = !!rect && naturalWidth > 0;
    frame.hidden = !ready;
    const box = ready ? boxOfRect(rect!, naturalWidth, naturalHeight) : null;
    const shown = shownBox();
    const unchanged = !box || !shown || sameBox(box, shown);
    current.hidden = !ready || !shown || unchanged;
    if (shown && !current.hidden) place(current, rectOfBox(shown));
    recropButton.disabled = busy || !box || unchanged;
    resetButton.disabled = busy || unchanged;
    for (const b of history.querySelectorAll('button')) b.disabled = busy;
    win.panel.classList.toggle('panel-cropper--busy', busy);
    if (!ready || !box) return;
    place(frame, rect!);
    const [xmin, ymin, xmax, ymax] = box;
    // The preview keeps the aspect of the cut, at most PREVIEW_MAX on its long side (shown fitted by CSS).
    const ratio = Math.min(PREVIEW_MAX / (xmax - xmin), PREVIEW_MAX / (ymax - ymin));
    preview.width = Math.max(1, Math.round((xmax - xmin) * ratio));
    preview.height = Math.max(1, Math.round((ymax - ymin) * ratio));
    const ctx = preview.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, xmin, ymin, xmax - xmin, ymax - ymin, 0, 0, preview.width, preview.height);
  }

  // ── Zoom and position ──
  function applyView(): void {
    Object.assign(canvasArea.style, {
      left: `${viewX}px`,
      top: `${viewY}px`,
      width: px(naturalWidth),
      height: px(naturalHeight),
    });
    zoomLabel.textContent = naturalWidth ? `${Math.round(scale * 100)}%` : '';
    render();
  }

  /** The whole page in the stage (small pages enlarged too). */
  function fit(): void {
    if (!naturalWidth) return;
    const w = stage.clientWidth - FIT_PADDING * 2;
    const hgt = stage.clientHeight - FIT_PADDING * 2;
    scale = Math.max(MIN_SCALE, Math.min(w / naturalWidth, hgt / naturalHeight));
    viewX = (stage.clientWidth - naturalWidth * scale) / 2;
    viewY = (stage.clientHeight - naturalHeight * scale) / 2;
    fitted = true;
    applyView();
  }

  /** Zooms to `next` keeping the stage point (sx, sy) in place (default: the centre). */
  function zoomAround(next: number, sx = stage.clientWidth / 2, sy = stage.clientHeight / 2): void {
    if (!naturalWidth) return;
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    viewX = sx - ((sx - viewX) * clamped) / scale;
    viewY = sy - ((sy - viewY) * clamped) / scale;
    scale = clamped;
    fitted = false;
    applyView();
  }

  /** The frame (with some room around it) as large as the stage allows. */
  function focusFrame(): void {
    if (!rect || !naturalWidth) return;
    const w = rect.w * (1 + FOCUS_MARGIN * 2);
    const hgt = rect.h * (1 + FOCUS_MARGIN * 2);
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(stage.clientWidth / w, stage.clientHeight / hgt)));
    viewX = stage.clientWidth / 2 - (rect.x + rect.w / 2) * scale;
    viewY = stage.clientHeight / 2 - (rect.y + rect.h / 2) * scale;
    fitted = false;
    applyView();
  }

  const stagePoint = (e: MouseEvent) => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const onFrame = (e: Event) => !!(e.target as HTMLElement).closest('.panel-cropper__frame');

  // The stage follows the window size: a fitted page stays fitted.
  const resizeObserver = new ResizeObserver(() => {
    if (fitted && naturalWidth) fit();
  });
  resizeObserver.observe(stage);

  stage.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      zoomAround(e.deltaY < 0 ? scale * WHEEL_STEP : scale / WHEEL_STEP, ...stagePoint(e));
    },
    { passive: false },
  );
  stage.addEventListener('dblclick', e => {
    if (onFrame(e)) return;
    if (fitted) zoomAround(1, ...stagePoint(e));
    else fit();
  });
  // Dragging the page (anywhere but the frame) moves the view.
  let pan: { x: number; y: number; startX: number; startY: number } | null = null;
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0 || onFrame(e) || !naturalWidth) return;
    pan = { x: e.clientX, y: e.clientY, startX: viewX, startY: viewY };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('panel-cropper__stage--panning');
  });
  stage.addEventListener('pointermove', e => {
    if (!pan) return;
    viewX = pan.startX + e.clientX - pan.x;
    viewY = pan.startY + e.clientY - pan.y;
    fitted = false;
    applyView();
  });
  const endPan = () => {
    pan = null;
    stage.classList.remove('panel-cropper__stage--panning');
  };
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);

  function renderHistory(): void {
    if (!state) {
      history.replaceChildren(h('div', { class: 'panel-cropper__status', text: 'このコマは表示されていません。' }));
      return;
    }
    const { versions, shown } = state;
    // Newest first.
    const rows = versions
      .map((version, index) => ({ version, index }))
      .reverse()
      .map(({ version, index }) =>
        h(
          'button',
          {
            class: `panel-cropper__version${index === shown ? ' panel-cropper__version--shown' : ''}`,
            title: index === shown ? '表示中の版' : 'この版を表示する（この版から作った画像も表示されます）',
            attrs: { role: 'listitem', 'aria-current': index === shown ? 'true' : 'false' },
            dataset: { index: String(index) },
            onclick: () => void pick(index),
          },
          icon(index === shown ? 'radio_button_checked' : 'radio_button_unchecked', 16),
          h('span', { class: 'panel-cropper__version-label', text: version.label }),
          h('span', { class: 'panel-cropper__version-meta', text: `${version.createdAt}　${sizeOf(version.box)}` }),
        ),
      );
    history.replaceChildren(...rows);
  }

  function resetFrame(): void {
    const box = shownBox();
    rect = box ? rectOfBox(box) : null;
    render();
  }

  /** Reads the versions again (after a pick or a re-cut) and puts the frame on the shown one. */
  function refresh(): void {
    state = host.state();
    renderHistory();
    resetFrame();
  }

  async function pick(index: number): Promise<void> {
    if (busy || !state || index === state.shown) return;
    busy = true;
    render();
    try {
      await host.pick(index);
    } finally {
      busy = false;
      refresh();
      status.textContent = state ? `「${state.versions[state.shown]?.label}」を表示しています。` : '';
    }
  }

  async function recrop(): Promise<void> {
    if (busy || !rect) return;
    const box = boxOfRect(rect, naturalWidth, naturalHeight);
    busy = true;
    status.textContent = '切り出し直しています…';
    render();
    let ok = false;
    try {
      ok = await host.recrop(box);
    } finally {
      busy = false;
      if (ok) {
        refresh();
        status.textContent = `「${state?.versions[state.shown]?.label ?? ''}」として切り出し直しました。`;
      } else {
        status.textContent = '';
        render();
      }
    }
  }

  // Dragging the frame moves it; dragging a corner / an edge resizes it (the opposite side stays).
  frame.addEventListener('pointerdown', e => {
    if (!rect || busy) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, rect };
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    const onMove = (ev: PointerEvent) => {
      if (handle) {
        const area = canvasArea.getBoundingClientRect();
        rect = resizeRect(
          start.rect,
          handle,
          (ev.clientX - area.left) / scale,
          (ev.clientY - area.top) / scale,
          naturalWidth,
          naturalHeight,
        );
      } else {
        rect = moveRect(
          start.rect,
          (ev.clientX - start.x) / scale,
          (ev.clientY - start.y) / scale,
          naturalWidth,
          naturalHeight,
        );
      }
      render();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  async function loadPage(): Promise<void> {
    status.textContent = 'ページを読み込んでいます…';
    try {
      const blob = await host.loadPage();
      if (!blob) throw new Error('分割前のページが見つかりません');
      objectUrl = URL.createObjectURL(blob);
      img.src = objectUrl;
      await img.decode();
    } catch (err) {
      status.textContent = `ページを読み込めませんでした（${describeError(err).message}）`;
      return;
    }
    naturalWidth = img.naturalWidth;
    naturalHeight = img.naturalHeight;
    status.textContent = '';
    resetFrame();
    fit();
  }

  renderHistory();
  render();
  void loadPage();
}
