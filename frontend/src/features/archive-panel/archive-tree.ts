/**
 * Pure helpers for the ARCHIVES tree (unit tested in archive-tree.test.ts).
 *
 * The backend returns top-level archives and, per archive, a flat list of entries linked by
 * `folderId`. The panel shows them as a tree; folders are collapsed unless the shared
 * collapse state says otherwise.
 */
import { TEXT_FILE_PATTERN } from '../../shared/config';
import type { ArchiveEntry } from '../../shared/types/archive';

export interface TreeRow {
  item: ArchiveEntry;
  depth: number;
  isGroup: boolean;
  collapsed: boolean;
}

/** Folder key -> collapsed. Missing keys count as collapsed. */
export type CollapseState = Record<string, boolean>;

export function isCollapsed(state: CollapseState, key: string): boolean {
  return state[key] ?? true;
}

/** Depth-first rows: children of expanded folders follow their parent. */
export function buildTreeRows(entries: ArchiveEntry[], collapse: CollapseState): TreeRow[] {
  const rows: TreeRow[] = [];
  const visit = (items: ArchiveEntry[], depth: number) => {
    for (const item of items) {
      const isGroup = item.type === 'folder';
      const collapsed = isCollapsed(collapse, item.key);
      rows.push({ item, depth, isGroup, collapsed });
      if (isGroup && !collapsed)
        visit(
          entries.filter(e => e.folderId === item.key),
          depth + 1,
        );
    }
  };
  visit(
    entries.filter(e => !e.folderId),
    0,
  );
  return rows;
}

/** Folder keys that must be expanded to reveal `key` ("a/b/c.png" -> ["a", "a/b"]). */
export function ancestorKeys(key: string): string[] {
  const parts = key.replace(/\\/g, '/').split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** Row index for an auto-select key; falls back to a same-named file directly under the archive. */
export function findRowIndex(rows: TreeRow[], key: string): number {
  const target = key.replace(/\\/g, '/');
  const exact = rows.findIndex(r => r.item.key.replace(/\\/g, '/') === target);
  if (exact !== -1) return exact;
  const parts = target.split('/');
  const fileName = parts[parts.length - 1]?.toLowerCase();
  return rows.findIndex(r => r.item.folderId === parts[0] && r.item.name.toLowerCase() === fileName);
}

/**
 * Whether each row is drawn as selected: directly selected rows, plus every row nested
 * below a selected folder.
 */
export function effectiveSelection(rows: TreeRow[], selected: ReadonlySet<number>): boolean[] {
  let groupDepth = -1;
  return rows.map((row, i) => {
    let inSelectedGroup = false;
    if (groupDepth !== -1) {
      if (row.depth > groupDepth) inSelectedGroup = true;
      else groupDepth = -1;
    }
    const direct = selected.has(i);
    if (direct && row.isGroup) groupDepth = row.depth;
    return direct || inSelectedGroup;
  });
}

/** Display name: files without an extension are shown as ".png". */
export function displayName(row: TreeRow): string {
  return !row.isGroup && !row.item.name.includes('.') ? `${row.item.name}.png` : row.item.name;
}

/** One thing the delete button moves to the trash: a whole archive (`path` = '') or an entry inside one. */
export interface DeletionTarget {
  archive: string;
  /** Path inside the archive ('' for the whole archive). */
  path: string;
  /** Shown in the toasts. */
  name: string;
}

/**
 * What deleting `items` moves to the trash, one target per archive / entry: entries inside a selected
 * archive or folder go with it and are not listed again.
 */
export function planDeletion(items: ArchiveEntry[]): DeletionTarget[] {
  const archives = new Set(items.filter(i => i.type === 'folder' && !i.folderId).map(i => i.key));
  const selectedKeys = new Set(items.map(i => i.key));
  const isInsideSelected = (key: string) => {
    for (let i = key.indexOf('/'); i !== -1; i = key.indexOf('/', i + 1)) {
      if (selectedKeys.has(key.slice(0, i))) return true;
    }
    return false;
  };
  const targets: DeletionTarget[] = [];
  for (const item of items) {
    if (archives.has(item.key)) {
      targets.push({ archive: item.key, path: '', name: item.name });
      continue;
    }
    const slash = item.key.indexOf('/');
    if (slash === -1 || isInsideSelected(item.key)) continue;
    targets.push({ archive: item.key.slice(0, slash), path: item.key.slice(slash + 1), name: item.name });
  }
  return targets;
}

/** Start of a toast about `targets`: "「<name>」を" for one, "<N> 件を" for more. */
export function targetsLabel(targets: readonly DeletionTarget[]): string {
  return targets.length === 1 ? `「${targets[0].name}」を` : `${targets.length} 件を`;
}

/** Files of the selection in tree (display) order; selected folders are ignored. */
export function selectedFiles(rows: TreeRow[], selected: ReadonlySet<number>): ArchiveEntry[] {
  return [...selected]
    .sort((a, b) => a - b)
    .map(i => rows[i])
    .filter(row => row && !row.isGroup)
    .map(row => row.item);
}

/** Drops text files (json / txt / md): Batch mode only shows images. */
export function withoutTextFiles(entries: ArchiveEntry[]): ArchiveEntry[] {
  return entries.filter(e => !TEXT_FILE_PATTERN.test(e.name));
}

/** Files (not folders) under a folder key, for Batch mode. */
export function imagesUnder(entries: ArchiveEntry[], folderKey: string): ArchiveEntry[] {
  return entries.filter(e => e.type !== 'folder' && (e.folderId === folderKey || e.key.startsWith(`${folderKey}/`)));
}

/**
 * The selection after the tree was rebuilt, matched by key: entries no longer shown (deleted, or
 * hidden in a collapsed folder) drop out. `last` is kept only while its entry is still selected.
 */
export function remapSelection(
  oldRows: TreeRow[],
  selected: Iterable<number>,
  last: number | null,
  newRows: TreeRow[],
): { selected: number[]; last: number | null; changed: boolean } {
  const indexOf = (i: number | null) => {
    const key = i === null ? undefined : oldRows[i]?.item.key;
    return key === undefined ? -1 : newRows.findIndex(r => r.item.key === key);
  };
  const before = [...selected];
  const after = before.map(indexOf).filter(i => i !== -1);
  const lastIndex = indexOf(last);
  return {
    selected: after,
    last: after.includes(lastIndex) ? lastIndex : null,
    changed: after.length !== before.length,
  };
}
