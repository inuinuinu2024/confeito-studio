/**
 * アイコンの切り取り (docs/specs/character-manager.md): a modal window that turns part of one of the
 * character's images into a 256x256 PNG icon. The backend detects anime faces in the chosen image and
 * the square frame starts on the best one (dashed boxes show every face; a click moves the frame there).
 * The frame is moved by dragging it and resized by its corners; the preview follows. While the faces are
 * detected, an hourglass covers the image and nothing can be changed except 中断 (then the frame is set by
 * hand), × and Esc. A 別ウィンドウ (shared/ui/window.ts): ×, Esc and a click outside close it without an icon.
 */
import { detectFaces, type DetectedFace } from '../../shared/api/characters';
import { h, icon } from '../../shared/ui/dom';
import { button } from '../../shared/ui/form';
import { showToast } from '../../shared/ui/toast';
import { describeError } from '../../shared/utils/error-message';
import {
  type Corner,
  type Crop,
  defaultCrop,
  faceCrop,
  ICON_SIZE,
  moveCrop,
  resizeCrop,
} from '../../shared/utils/icon-crop';
import { canvasToBlob } from '../../shared/utils/image';
import { openWindow } from '../../shared/ui/window';

/** An image to cut the icon from. */
export interface CropSource {
  thumb: string;
  label: string;
  load(): Promise<Blob>;
}

const STAGE_WIDTH = 560;
const STAGE_HEIGHT = 420;
const PREVIEW_SIZE = 128;
/** After this long, the detection is probably downloading the model (first use). */
const SLOW_DETECTION_MS = 3000;
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

/** Resolves the icon as a PNG, or null when cancelled. */
export function openIconCropper(sources: CropSource[], initial = 0): Promise<Blob | null> {
  return new Promise(resolve => {
    let objectUrl: string | null = null;
    let result: Blob | null = null;
    const win = openWindow({
      title: 'アイコンの切り取り',
      className: 'icon-cropper',
      onClose: () => {
        detecting?.abort();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(result);
      },
    });
    const finish = (cropped: Blob) => {
      result = cropped;
      win.close();
    };

    let selected = -1;
    let token = 0;
    let naturalWidth = 0;
    let naturalHeight = 0;
    let scale = 1;
    let crop: Crop | null = null;
    /** The running face detection (the image cannot be changed meanwhile). */
    let detecting: AbortController | null = null;
    let slowNoticeShown = false;

    const sourceBar = h('div', { class: 'icon-cropper__sources' });
    const sourceButtons = sources.map((source, i) =>
      h(
        'button',
        { class: 'icon-cropper__source', title: source.label, onclick: () => void select(i) },
        h('img', { src: source.thumb, alt: source.label, draggable: false }),
      ),
    );
    sourceBar.append(...sourceButtons);

    const img = h('img', { class: 'icon-cropper__image', alt: '', draggable: false });
    const faceLayer = h('div', { class: 'icon-cropper__faces' });
    const frame = h(
      'div',
      { class: 'icon-cropper__frame', title: 'ドラッグで移動、四隅で大きさを変更' },
      ...CORNERS.map(corner =>
        h('div', { class: `icon-cropper__handle icon-cropper__handle--${corner}`, dataset: { corner } }),
      ),
    );
    const canvasArea = h('div', { class: 'icon-cropper__canvas' }, img, faceLayer, frame);
    const busy = h(
      'div',
      { class: 'icon-cropper__busy', hidden: true },
      icon('hourglass_top', 40),
      h('div', { text: '顔を検出しています…' }),
      button('中断', () => detecting?.abort(), { size: 'small' }),
    );
    const stage = h('div', { class: 'icon-cropper__stage' }, canvasArea, busy);
    const preview = h('canvas', { class: 'icon-cropper__preview', width: PREVIEW_SIZE, height: PREVIEW_SIZE });
    const status = h('div', { class: 'icon-cropper__status' });
    const confirm = button('決定', () => void decide(), { variant: 'primary', size: 'dialog' });

    win.body.append(
      sourceBar,
      h(
        'div',
        { class: 'icon-cropper__body' },
        stage,
        h(
          'div',
          { class: 'icon-cropper__side' },
          h('div', { class: 'cs-field__label', text: `でき上がり（${ICON_SIZE}×${ICON_SIZE}）` }),
          preview,
        ),
      ),
      status,
    );
    win.footer(confirm);

    const px = (value: number) => `${value * scale}px`;

    function render(): void {
      // The frame is hidden while detecting: it cannot be moved then, and it moves to the face afterwards.
      frame.hidden = !crop || !!detecting;
      confirm.disabled = !crop || !!detecting;
      busy.hidden = !detecting;
      for (const b of sourceButtons) b.disabled = !!detecting;
      if (!crop) return;
      Object.assign(frame.style, { left: px(crop.x), top: px(crop.y), width: px(crop.size), height: px(crop.size) });
      const ctx = preview.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    }

    function showFaces(faces: DetectedFace[]): void {
      faceLayer.replaceChildren(
        ...faces.map((face, i) => {
          const box = h('div', {
            class: 'icon-cropper__face',
            title: `顔 ${i + 1}（クリックでこの顔に合わせる）`,
            onclick: () => {
              crop = faceCrop(face, naturalWidth, naturalHeight);
              render();
            },
          });
          Object.assign(box.style, {
            left: px(face.x),
            top: px(face.y),
            width: px(face.width),
            height: px(face.height),
          });
          return box;
        }),
      );
    }

    async function select(index: number): Promise<void> {
      if (index === selected) return;
      selected = index;
      const current = ++token;
      sourceButtons.forEach((b, i) => b.classList.toggle('icon-cropper__source--active', i === index));
      crop = null;
      faceLayer.replaceChildren();
      render();
      status.textContent = '画像を読み込んでいます…';
      let blob: Blob;
      try {
        blob = await sources[index].load();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
        await img.decode();
      } catch (err) {
        if (current === token) status.textContent = `画像を読み込めませんでした（${describeError(err).message}）`;
        return;
      }
      if (current !== token) return;
      naturalWidth = img.naturalWidth;
      naturalHeight = img.naturalHeight;
      scale = Math.min(STAGE_WIDTH / naturalWidth, STAGE_HEIGHT / naturalHeight);
      Object.assign(canvasArea.style, { width: px(naturalWidth), height: px(naturalHeight) });
      crop = defaultCrop(naturalWidth, naturalHeight);
      const controller = new AbortController();
      detecting = controller;
      render();
      status.textContent = '顔を検出しています…';
      const slow = window.setTimeout(() => {
        if (slowNoticeShown || controller.signal.aborted) return;
        slowNoticeShown = true;
        showToast('顔検出のモデルを準備しています（初回のみ。約 45MB をダウンロードします）', 'info');
      }, SLOW_DETECTION_MS);
      try {
        const { faces } = await detectFaces(blob, controller.signal);
        showFaces(faces);
        if (faces.length) crop = faceCrop(faces[0], naturalWidth, naturalHeight);
        status.textContent = faces.length
          ? `顔を ${faces.length} 件検出しました。枠を動かして調整できます。`
          : '顔を検出できませんでした。枠を動かして範囲を指定してください。';
      } catch (err) {
        if (controller.signal.aborted) {
          status.textContent = '顔の検出を中断しました。枠を動かして範囲を指定してください。';
        } else {
          showToast(`顔を検出できませんでした: ${describeError(err).message}`, 'warning');
          status.textContent = '顔を検出できませんでした。枠を動かして範囲を指定してください。';
        }
      } finally {
        window.clearTimeout(slow);
        detecting = null;
        render();
      }
    }

    // Dragging the frame moves it; dragging a corner resizes it (the opposite corner stays).
    frame.addEventListener('pointerdown', e => {
      if (!crop || detecting) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, crop };
      const corner = (e.target as HTMLElement).dataset.corner as Corner | undefined;
      const onMove = (ev: PointerEvent) => {
        if (corner) {
          const rect = canvasArea.getBoundingClientRect();
          crop = resizeCrop(
            start.crop,
            corner,
            (ev.clientX - rect.left) / scale,
            (ev.clientY - rect.top) / scale,
            naturalWidth,
            naturalHeight,
          );
        } else {
          crop = moveCrop(
            start.crop,
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

    async function decide(): Promise<void> {
      if (!crop) return;
      const canvas = h('canvas', { width: ICON_SIZE, height: ICON_SIZE });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, ICON_SIZE, ICON_SIZE);
      const icon = await canvasToBlob(canvas, 'image/png');
      if (icon) finish(icon);
      else showToast('アイコンを作れませんでした', 'warning');
    }

    render();
    void select(Math.min(Math.max(initial, 0), sources.length - 1));
  });
}
