/** Saving files through the browser's download (works the same in the planned web version). */
import { h } from '../ui/dom';

/** Saves `blob` as `name` in the browser's download folder. */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
