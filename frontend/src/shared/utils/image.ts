/** Canvas / Blob / base64 conversions. */

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

/** Base64 payload of a Blob/File (without the "data:...;base64," prefix). */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64: string, type: string): Blob {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return new Blob([bytes], { type });
}

/** Decodes an image Blob; rejects if it is not a decodable image. */
export function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = err => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/** Draws an image source onto a new canvas of the same size. */
export function toCanvas(source: CanvasImageSource & { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d')?.drawImage(source, 0, 0);
  return canvas;
}

/** Decodes an image Blob into a canvas; null when it cannot be decoded. */
export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement | null> {
  try {
    return toCanvas(await loadImage(blob));
  } catch {
    return null;
  }
}

/** File extension for a generated image MIME type. */
export function imageExtension(mimeType: string): '.jpg' | '.png' {
  return mimeType.includes('jpeg') ? '.jpg' : '.png';
}
