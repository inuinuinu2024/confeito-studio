/**
 * Thumbnails of the flow cells, fetched once per image and kept in memory as object URLs for this session
 * (never in browser storage or the HTTP cache: docs/specs/app-shell.md).
 */
import { fetchThumbnail } from '../../shared/api/archives';

/** Long side in pixels: sharp enough for a cell up to about 150% zoom. */
export const THUMBNAIL_SIZE = 320;

const cache = new Map<string, Promise<string | null>>();

/** Object URL of the thumbnail of `key`, or null when it cannot be made. */
export function thumbnailUrl(key: string): Promise<string | null> {
  let url = cache.get(key);
  if (!url) {
    url = fetchThumbnail(key, THUMBNAIL_SIZE)
      .then(blob => URL.createObjectURL(blob))
      .catch(err => {
        console.warn(`Thumbnail of ${key} failed`, err);
        cache.delete(key); // tried again next time
        return null;
      });
    cache.set(key, url);
  }
  return url;
}

/** Drops every thumbnail (refresh, another archives folder: the same keys may hold other files). */
export function forgetThumbnails(): void {
  for (const url of cache.values()) void url.then(u => u && URL.revokeObjectURL(u));
  cache.clear();
}
