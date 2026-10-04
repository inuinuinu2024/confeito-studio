/**
 * The square crop frame of a character icon, in the pixels of the source image (pure, unit tested;
 * docs/specs/character-manager.md 「アイコンの切り取り」). The frame always stays inside the image.
 */

export const ICON_SIZE = 256;
/** How much larger than the face the frame is, so that the hair fits too. */
export const FACE_MARGIN = 1.6;
/** Side of the frame without a face, relative to the short side of the image. */
export const DEFAULT_RATIO = 0.6;
export const MIN_CROP = 16;

export interface Crop {
  x: number;
  y: number;
  size: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** The smallest frame allowed (the image's short side when it is smaller than MIN_CROP). */
function minSize(width: number, height: number): number {
  return Math.min(MIN_CROP, width, height);
}

/** A frame of `size` centred on (cx, cy), moved inside the image. */
function centred(cx: number, cy: number, size: number, width: number, height: number): Crop {
  const side = clamp(size, minSize(width, height), Math.min(width, height));
  return { x: clamp(cx - side / 2, 0, width - side), y: clamp(cy - side / 2, 0, height - side), size: side };
}

/** The frame for a detected face: centred on it, FACE_MARGIN times its larger side. */
export function faceCrop(face: Box, width: number, height: number): Crop {
  return centred(
    face.x + face.width / 2,
    face.y + face.height / 2,
    Math.max(face.width, face.height) * FACE_MARGIN,
    width,
    height,
  );
}

/** The frame without a face: in the middle, DEFAULT_RATIO of the short side. */
export function defaultCrop(width: number, height: number): Crop {
  return centred(width / 2, height / 2, Math.min(width, height) * DEFAULT_RATIO, width, height);
}

/** The frame moved by (dx, dy), kept inside the image. */
export function moveCrop(crop: Crop, dx: number, dy: number, width: number, height: number): Crop {
  return { ...crop, x: clamp(crop.x + dx, 0, width - crop.size), y: clamp(crop.y + dy, 0, height - crop.size) };
}

/**
 * The frame resized by dragging `corner` to (px, py): the opposite corner stays, the frame stays square
 * (the larger of the two distances) and inside the image, and not smaller than MIN_CROP.
 */
export function resizeCrop(crop: Crop, corner: Corner, px: number, py: number, width: number, height: number): Crop {
  const left = corner === 'nw' || corner === 'sw';
  const top = corner === 'nw' || corner === 'ne';
  const ax = left ? crop.x + crop.size : crop.x;
  const ay = top ? crop.y + crop.size : crop.y;
  const room = Math.min(left ? ax : width - ax, top ? ay : height - ay);
  const size = clamp(Math.max(Math.abs(px - ax), Math.abs(py - ay)), minSize(width, height), room);
  return { x: left ? ax - size : ax, y: top ? ay - size : ay, size };
}
