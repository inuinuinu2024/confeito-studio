/**
 * Reference images of the Gemini tools as one ordered list (pure, unit tested).
 * The position in the list is the "# Image N" index of the prompt; each image has its own
 * type (zone: Object / Character / Style), "important" flag and description.
 * Only the total number of images is limited (the sum of the model's per-type numbers); the
 * per-type numbers are recommendations that may be exceeded.
 */

export interface ZoneDef {
  /** e.g. "スタイル参照 (Style)". */
  title: string;
  /** Recommended number of images of this type (Gemini guide); the total limit is the sum. */
  max: number;
}

export interface ReferenceImage {
  file: File;
  /** Title of the image's type (a ZoneDef title). */
  zoneTitle: string;
  isImportant?: boolean;
  /** Free text sent under the image's heading in the prompt (empty = nothing). */
  description?: string;
}

/** "スタイル参照 (Style)" -> "スタイル参照" (used in the prompt text). */
export function zoneLabel(zoneTitle: string): string {
  return zoneTitle.split(' (')[0];
}

/** "スタイル参照 (Style)" -> "Style" (used in the counters). */
export function zoneShortName(zoneTitle: string): string {
  return /\(([^)]+)\)\s*$/.exec(zoneTitle)?.[1] ?? zoneTitle;
}

export function countInZone(images: readonly Pick<ReferenceImage, 'zoneTitle'>[], zoneTitle: string): number {
  return images.filter(image => image.zoneTitle === zoneTitle).length;
}

/** How many reference images the model accepts in total (the sum of the per-type numbers). */
export function totalLimit(zones: readonly ZoneDef[]): number {
  return zones.reduce((sum, zone) => sum + zone.max, 0);
}

/**
 * The type a newly added image gets: the first type still under its recommended number, else the
 * first type. Null when the total limit is reached.
 */
export function zoneForNewImage(
  images: readonly Pick<ReferenceImage, 'zoneTitle'>[],
  zones: readonly ZoneDef[],
): ZoneDef | null {
  if (zones.length === 0 || images.length >= totalLimit(zones)) return null;
  return zones.find(zone => countInZone(images, zone.title) < zone.max) ?? zones[0];
}

/**
 * Fits the list (in place) to another model: images of a type the model does not have get its
 * first type, and images beyond the total limit are removed from the end.
 */
export function fitImagesToModel(
  images: Pick<ReferenceImage, 'zoneTitle'>[],
  zones: readonly ZoneDef[],
): { retyped: number; removed: number } {
  let retyped = 0;
  if (zones.length) {
    for (const image of images) {
      if (zones.some(zone => zone.title === image.zoneTitle)) continue;
      image.zoneTitle = zones[0].title;
      retyped++;
    }
  }
  const removed = Math.max(0, images.length - totalLimit(zones));
  images.splice(images.length - removed, removed);
  return { retyped, removed };
}

/** Rewrites `images` (in place) to `order`, which must contain the same items. */
export function reorderImages<T>(images: T[], order: readonly T[]): void {
  if (order.length !== images.length || order.some(item => !images.includes(item))) return;
  images.splice(0, images.length, ...order);
}
