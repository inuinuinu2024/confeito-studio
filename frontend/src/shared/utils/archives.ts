/**
 * Pure helpers for archives seen from the Archive Manager and the image export
 * (docs/specs/archive-manager.md, docs/specs/archives.md 「エクスポート / インポート」).
 */

/** Longest display name (backend: archive_service.DISPLAY_NAME_MAX). */
export const DISPLAY_NAME_MAX = 100;

const UNSAFE_FILE_CHARS = /[\/:*?"<>|\u0000-\u001f]/g;

/**
 * The file name an image is saved as (same rule as the backend's zip: archive_transfer.image_file_name):
 * a page keeps its name, an image in a result folder gets the folder in front ("<folder>_<name>").
 */
export function imageFileName(key: string): string {
  const slash = key.indexOf('/');
  const rel = slash === -1 ? key : key.slice(slash + 1);
  return rel.replace(/\//g, '_').replace(UNSAFE_FILE_CHARS, '_') || 'image';
}

/** Why `name` cannot be a display name (null when it can). The backend checks it again. */
export function displayNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'アーカイブの名前を入力してください。';
  if (trimmed.length > DISPLAY_NAME_MAX) return `アーカイブの名前は ${DISPLAY_NAME_MAX} 文字以内にしてください。`;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return 'アーカイブの名前に使えない文字が含まれています。';
  return null;
}

/** "980 B", "12.3 KB", "4.5 MB", "1.2 GB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** The archives whose display name contains every space-separated word of `query` (case-insensitive). */
export function filterArchives<T extends { name: string }>(archives: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...archives];
  return archives.filter(a => words.every(w => a.name.toLowerCase().includes(w)));
}
