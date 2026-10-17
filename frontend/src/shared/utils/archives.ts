/**
 * Pure helpers for archives seen from the Archive Manager and the image export
 * (docs/specs/archive-manager.md, docs/specs/archives.md 「エクスポート / インポート」).
 */

/**
 * Where a tool result was saved, as the user knows it (tool windows' 保存先 and the tools' toasts,
 * docs/specs/notifications.md): "<display name> / <result folder>", or the display name alone for a result saved
 * as a new archive (the folder key is the archive itself).
 */
export function savedPlace(folder: string, archiveName: string): string {
  const slash = folder.indexOf('/');
  return slash === -1 ? archiveName : `${archiveName} / ${folder.slice(slash + 1)}`;
}

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

/** "a.b.png" -> { stem: "a.b", ext: ".png" }; a name without an extension has ext "". */
export function splitFileName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: '' };
}

/** `stem` + `ext` usable as a file name (characters a file name cannot have become "_"). */
export function exportFileName(stem: string, ext: string): string {
  return `${stem.trim().replace(UNSAFE_FILE_CHARS, '_')}${ext}`;
}

/**
 * Why each name of an export (stem + extension) cannot be used, or null: empty, or the same as another one
 * (ignoring case, as Windows does). Same order as `names`.
 */
export function exportNameErrors(names: readonly { stem: string; ext: string }[]): (string | null)[] {
  const full = names.map(n => exportFileName(n.stem, n.ext).toLowerCase());
  return names.map((n, i) => {
    if (!n.stem.trim()) return 'ファイル名を入力してください';
    return full.indexOf(full[i]) !== i || full.lastIndexOf(full[i]) !== i ? '同じ名前があります' : null;
  });
}

/**
 * `count` names numbered from `start` (書き出しの「連番を付ける」): the "#"s in `base` become the number, as many digits as
 * there are "#"s ("第1話_##" -> 第1話_01, 第1話_02 …); without "#", "_<number>" is put after it with two digits (three from 100).
 */
export function serialNames(base: string, start: number, count: number): string[] {
  const hashes = /#+/.exec(base);
  const last = start + count - 1;
  const digits = hashes ? hashes[0].length : Math.max(2, String(last).length);
  return Array.from({ length: count }, (_, i) => {
    const n = String(start + i).padStart(digits, '0');
    return hashes ? base.slice(0, hashes.index) + n + base.slice(hashes.index + hashes[0].length) : `${base}_${n}`;
  });
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
