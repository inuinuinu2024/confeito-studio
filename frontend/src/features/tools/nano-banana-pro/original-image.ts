/**
 * 原画 section of the Nano Banana画像生成 tool (docs/specs/tools/nano-banana-pro.md 「原画」) and the
 * canvas work around the generation: padding the original to the output's aspect ratio before
 * sending, and cutting it back out of the generated image at the original's size.
 * The geometry is in original.ts.
 */
import { DocumentManager } from '../../document/DocumentManager';
import { h, icon } from '../../../shared/ui/dom';
import { button, helpIcon } from '../../../shared/ui/form';
import { showToast } from '../../../shared/ui/toast';
import { canvasToBlob, loadImage } from '../../../shared/utils/image';
import { type OriginalLayout, type Rect, restoreCrop } from './original';

export interface OriginalImage {
  file: File;
  width: number;
  height: number;
  /** ARCHIVES key when it was taken from the canvas; null for a file added from outside. */
  key: string | null;
}

const HELP = [
  '原画を設定すると、出力はこの原画を書き直した画像になります（ラフ → 清書、線画 → 着彩など）。',
  'アスペクト比は原画に最も近いものが自動で選ばれ、足りない側に白い余白を足して送ります。',
  '生成された画像から余白を切り取り、原画と同じ大きさに戻して保存します（そのままの画像は Raw/ に保存）。',
  '原画は参照画像の後ろに 1 枚として送るので、参照画像の合計の上限は 1 枚減ります。',
].join('\n');

const objectUrls = new WeakMap<File, string>();
function previewUrl(file: File): string {
  let url = objectUrls.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    objectUrls.set(file, url);
  }
  return url;
}

/** Reads the size of an image file; null (with a warning toast) when it cannot be decoded. */
async function fromFile(file: File, key: string | null = null): Promise<OriginalImage | null> {
  try {
    const img = await loadImage(file);
    return { file, width: img.naturalWidth, height: img.naturalHeight, key };
  } catch {
    showToast(`「${file.name}」を画像として読み込めませんでした`, 'warning');
    return null;
  }
}

/** The image shown on the canvas as an original; null (with a warning toast) when nothing is shown. */
async function fromCanvas(): Promise<OriginalImage | null> {
  const docManager = DocumentManager.getInstance();
  const canvas = docManager.getCurrentCanvas();
  const blob = canvas ? await canvasToBlob(canvas) : null;
  if (!canvas || !blob) {
    showToast('キャンバスに画像が表示されていません。ARCHIVES で画像を選択してください。', 'warning');
    return null;
  }
  const file = new File([blob], docManager.getCurrentFilename() || 'canvas.png', { type: 'image/png' });
  return { file, width: canvas.width, height: canvas.height, key: docManager.getCurrentKey() };
}

/**
 * The 原画 section: an add area (click / drag & drop) and "表示中の画像を原画にする" while unset,
 * a card with the image, its size and `details` (how it is sent) once set.
 */
export function createOriginalSection(
  original: OriginalImage | null,
  details: string[],
  onChange: (original: OriginalImage | null) => void,
): HTMLElement {
  const set = (value: OriginalImage | null) => {
    if (value) onChange(value);
  };
  const header = h(
    'div',
    { class: 'cs-field__label-row' },
    h('label', { class: 'cs-field__label', text: '原画' }),
    helpIcon(HELP),
  );

  if (original) {
    const remove = h(
      'button',
      { class: 'ref-card__remove', title: '原画を解除', onclick: () => onChange(null) },
      icon('close', 16),
    );
    return h(
      'div',
      { class: 'nbp-original' },
      header,
      h(
        'div',
        { class: 'ref-card nbp-original__card' },
        h('div', { class: 'ref-card__thumb' }, h('img', { src: previewUrl(original.file), alt: original.file.name })),
        h(
          'div',
          { class: 'ref-card__main' },
          h(
            'div',
            { class: 'ref-card__head' },
            h('span', { class: 'ref-card__name', text: original.file.name }),
            remove,
          ),
          h('div', { class: 'nbp-caption', text: `${original.width} x ${original.height} px` }),
          ...details.map(text => h('div', { class: 'nbp-caption', text })),
        ),
      ),
    );
  }

  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const addArea = h('div', {
    class: 'cs-dropzone__area nbp-original__add',
    text: 'クリック または 画像をドラッグ＆ドロップで原画を設定',
  });
  const addFile = async (files: FileList | null) => {
    const file = Array.from(files ?? []).find(f => f.type.startsWith('image/'));
    if (file) set(await fromFile(file));
  };
  addArea.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    void addFile(fileInput.files);
    fileInput.value = '';
  });
  addArea.addEventListener('dragover', e => {
    e.preventDefault();
    addArea.classList.add('cs-dropzone__area--dragover');
  });
  addArea.addEventListener('dragleave', () => addArea.classList.remove('cs-dropzone__area--dragover'));
  addArea.addEventListener('drop', e => {
    e.preventDefault();
    addArea.classList.remove('cs-dropzone__area--dragover');
    void addFile(e.dataTransfer?.files ?? null);
  });
  return h(
    'div',
    { class: 'nbp-original' },
    header,
    addArea,
    fileInput,
    button('表示中の画像を原画にする', () => void fromCanvas().then(set), { block: true, size: 'small' }),
  );
}

/** The original centred on a white canvas of the output's aspect ratio (PNG), as sent to Gemini. */
export async function buildSentImage(original: OriginalImage, layout: OriginalLayout): Promise<Blob> {
  const img = await loadImage(original.file);
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = layout.sent;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('原画を送信用の画像にできませんでした');
  // Transparent parts become white too.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  const { x, y, w, h: height } = layout.content;
  ctx.drawImage(img, x, y, w, height);
  const blob = await canvasToBlob(canvas, 'image/png');
  if (!blob) throw new Error('原画を送信用の画像にできませんでした');
  return blob;
}

/**
 * Cuts the original's part (`rect`, normalized) out of the generated image and scales it to the
 * original's size, in the generated image's format.
 */
export async function restoreImage(
  generated: Blob,
  rect: Rect,
  width: number,
  height: number,
): Promise<{ blob: Blob; generatedSize: [number, number] }> {
  const img = await loadImage(generated);
  const generatedSize: [number, number] = [img.naturalWidth, img.naturalHeight];
  const crop = restoreCrop(rect, ...generatedSize);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('生成画像を原画の大きさに戻せませんでした');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
  const type = generated.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await canvasToBlob(canvas, type, type === 'image/jpeg' ? 0.95 : undefined);
  if (!blob) throw new Error('生成画像を原画の大きさに戻せませんでした');
  return { blob, generatedSize };
}
