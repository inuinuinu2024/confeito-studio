/**
 * Pieces of the Gemini image request shared by the tools: the per-image prompt headings,
 * image inputs and the archive entries of the reference images (docs/specs/tools/gemini-image.md).
 */
import type { GenerationInput } from '../../../shared/api/generation';
import { blobToBase64, canvasToBlob, imageExtension, loadImage } from '../../../shared/utils/image';
import { IMPORTANT_IMAGE_NOTE, MAX_UPLOAD_SIDE, ZONE_INSTRUCTIONS } from './constants';
import { type ReferenceImage, zoneLabel, zoneShortName } from './reference-list';

/**
 * "# 画像N\nこの画像は<type>の参照画像。<what to take from it>\n" (+ the important note, + the image's
 * description) and a blank line, for one reference image.
 */
export function imageHeading(
  index: number,
  image: Pick<ReferenceImage, 'zoneTitle' | 'isImportant' | 'description'>,
): string {
  const instruction = ZONE_INSTRUCTIONS[zoneShortName(image.zoneTitle)] ?? '';
  const description = image.description?.trim() ? `${image.description.trim()}\n` : '';
  return (
    `# 画像${index}\nこの画像は${zoneLabel(image.zoneTitle)}の参照画像。${instruction}\n` +
    `${image.isImportant ? IMPORTANT_IMAGE_NOTE : ''}${description}\n`
  );
}

export async function imageInput(blob: Blob, mimeType = blob.type || 'image/png'): Promise<GenerationInput> {
  return { type: 'image', mime_type: mimeType, data: await blobToBase64(blob) };
}

/** Size that fits width x height within maxSide on the longest side (unchanged when it already fits). */
export function fitWithin(width: number, height: number, maxSide = MAX_UPLOAD_SIDE): [number, number] {
  const scale = maxSide / Math.max(width, height);
  if (scale >= 1) return [width, height];
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/**
 * The image as sent to Gemini: unchanged when its longest side is within MAX_UPLOAD_SIDE, otherwise
 * scaled down to it (JPEG / WebP keep their format, anything else becomes PNG). An image that cannot
 * be decoded is sent as it is.
 */
export async function uploadImage(file: Blob): Promise<Blob> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }
  const [width, height] = fitWithin(img.naturalWidth, img.naturalHeight);
  if (width === img.naturalWidth && height === img.naturalHeight) return file;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  const type = ['image/jpeg', 'image/webp'].includes(file.type) ? file.type : 'image/png';
  return (await canvasToBlob(canvas, type, type === 'image/png' ? undefined : 0.92)) ?? file;
}

/** Archive entries "Inputs/<name><ext>" for the reference images. */
export function inputFiles(images: ReferenceImage[], nameOf: (image: ReferenceImage, index: number) => string) {
  return images.map((image, i) => ({
    blob: image.file as Blob,
    path: `Inputs/${nameOf(image, i)}${imageExtension(image.file.type || 'image/png')}`,
  }));
}

/** Emits `tool:progress` every second with the elapsed time; returns a stop function. */
export function startProgress(emitMessage: (seconds: number) => void): () => void {
  const start = Date.now();
  const timer = window.setInterval(() => emitMessage(Math.floor((Date.now() - start) / 1000)), 1000);
  return () => window.clearInterval(timer);
}
