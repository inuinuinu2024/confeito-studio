/**
 * Pieces of the Gemini image request shared by the tools: the per-image prompt headings,
 * image inputs and the archive entries of the reference images (docs/specs/tools/gemini-image.md).
 */
import type { GenerationInput } from '../../../shared/api/generation';
import { blobToBase64, imageExtension } from '../../../shared/utils/image';
import { IMPORTANT_IMAGE_NOTE } from './constants';
import { type ReferenceImage, zoneLabel } from './reference-images';

/** "# Image N\nこの画像を<zone>画像とする。\n" (+ the important note) for one reference image. */
export function imageHeading(index: number, image: Pick<ReferenceImage, 'zoneTitle' | 'isImportant'>): string {
  return `# Image ${index}\nこの画像を${zoneLabel(image.zoneTitle)}画像とする。\n${image.isImportant ? IMPORTANT_IMAGE_NOTE : ''}\n`;
}

export async function imageInput(blob: Blob, mimeType = blob.type || 'image/png'): Promise<GenerationInput> {
  return { type: 'image', mime_type: mimeType, data: await blobToBase64(blob) };
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
