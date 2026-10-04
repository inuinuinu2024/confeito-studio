/**
 * 原画 (original image) of the Nano Banana画像生成 tool: the output is the original redrawn, at
 * the original's size (pure, unit tested).
 *
 * The aspect ratio closest to the original is picked automatically, the original is centred on a
 * white canvas of that ratio (no distortion), and the content rectangle is kept in normalized
 * coordinates so it can be cut out of the generated image whatever size it comes back at.
 * Spec: docs/specs/tools/nano-banana-pro.md 「原画」
 */
import { MAX_UPLOAD_SIDE } from '../gemini-image/constants';
import { type ImageModel, outputSize } from './models';
import { UNSET } from './options';

/** Which sides get white padding: 'vertical' = above and below, 'horizontal' = left and right. */
export type Padding = 'none' | 'vertical' | 'horizontal';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OriginalLayout {
  /** Size of the image sent to Gemini (the output's aspect ratio). */
  sent: [number, number];
  /** Where the original is drawn in the sent image (integer px). */
  content: Rect;
  /** `content` normalized to 0..1 of the sent image. */
  rect: Rect;
  padding: Padding;
}

/** Output pixel size for the model / aspect ratio / size; an unset size counts as the API default 1K. */
export function expectedOutputSize(model: ImageModel, aspectRatio: string, imageSize: string): [number, number] | null {
  return outputSize(model, aspectRatio, imageSize === UNSET ? '1K' : imageSize);
}

/** The model's aspect ratio closest to width:height, compared by the real output pixels (e.g. 2:3 = 848x1264). */
export function autoAspectRatio(width: number, height: number, model: ImageModel): string {
  const target = Math.log(width / height);
  let best = model.aspectRatios[0];
  let bestDistance = Infinity;
  for (const ar of model.aspectRatios) {
    const size = expectedOutputSize(model, ar, '1K');
    const [w, h] = size ?? (ar.split(':').map(Number) as [number, number]);
    const distance = Math.abs(Math.log(w / h) - target);
    if (distance < bestDistance) {
      best = ar;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Centres a width x height original on a canvas with target's aspect ratio. The canvas is the
 * target size, scaled down so its longest side is at most maxSide.
 */
export function originalLayout(
  width: number,
  height: number,
  target: readonly [number, number],
  maxSide = MAX_UPLOAD_SIDE,
): OriginalLayout {
  const shrink = Math.min(1, maxSide / Math.max(target[0], target[1]));
  const sentW = Math.max(1, Math.round(target[0] * shrink));
  const sentH = Math.max(1, Math.round(target[1] * shrink));
  const scale = Math.min(sentW / width, sentH / height);
  const w = Math.min(sentW, Math.max(1, Math.round(width * scale)));
  const h = Math.min(sentH, Math.max(1, Math.round(height * scale)));
  const x = Math.floor((sentW - w) / 2);
  const y = Math.floor((sentH - h) / 2);
  const padding: Padding = h < sentH ? 'vertical' : w < sentW ? 'horizontal' : 'none';
  return {
    sent: [sentW, sentH],
    content: { x, y, w, h },
    rect: { x: x / sentW, y: y / sentH, w: w / sentW, h: h / sentH },
    padding,
  };
}

/** The part of a width x height generated image that corresponds to the original (integer px, inside the image). */
export function restoreCrop(rect: Rect, width: number, height: number): Rect {
  const x = Math.min(width - 1, Math.max(0, Math.round(rect.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.round(rect.y * height)));
  const right = Math.min(width, Math.max(x + 1, Math.round((rect.x + rect.w) * width)));
  const bottom = Math.min(height, Math.max(y + 1, Math.round((rect.y + rect.h) * height)));
  return { x, y, w: right - x, h: bottom - y };
}

const PADDING_SIDES: Record<Exclude<Padding, 'none'>, string> = { vertical: '上下', horizontal: '左右' };

/**
 * Prompt heading of the original, sent as image `index` (画像1, before the reference images). With reference
 * images it says how they relate to the original.
 */
export function originalHeading(index: number, padding: Padding, hasReferences = false): string {
  const pad =
    padding === 'none'
      ? ''
      : `画像の${PADDING_SIDES[padding]}にある白い余白は縦横比を合わせるための詰め物なので、何も描かず白のままにすること。\n`;
  const references = hasReferences
    ? `画像${index + 1} 以降の参照画像は書き直しの参考として使い、構図は原画に従うこと。\n`
    : '';
  return (
    `# 画像${index}（原画）\n` +
    'この画像を原画とする。出力はこの原画を書き直した画像にすること。構図・輪郭・各要素の位置と大きさは原画と一致させること。\n' +
    `${pad}${references}\n`
  );
}
