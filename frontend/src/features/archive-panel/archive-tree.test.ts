import { describe, expect, it } from 'vitest';
import type { ArchiveEntry } from '../../shared/types/archive';
import {
  ancestorKeys,
  buildTreeRows,
  displayName,
  effectiveSelection,
  findRowIndex,
  imagesUnder,
  selectedFiles,
  withoutTextFiles,
  planDeletion,
} from './archive-tree';

const folder = (key: string, folderId: string | null = null): ArchiveEntry => ({
  key,
  name: key.split('/').pop()!,
  type: 'folder',
  folderId,
  timestamp: 0,
});
const file = (key: string, folderId: string): ArchiveEntry => ({
  key,
  name: key.split('/').pop()!,
  type: 'image',
  folderId,
  timestamp: 0,
});

const entries = [
  folder('a'),
  folder('b'),
  file('a/x.png', 'a'),
  folder('a/sub', 'a'),
  file('a/sub/01.png', 'a/sub'),
  file('a/log.txt', 'a'),
];

describe('buildTreeRows', () => {
  it('shows only roots when everything is collapsed', () => {
    expect(buildTreeRows(entries, {}).map(r => r.item.key)).toEqual(['a', 'b']);
  });

  it('nests children of expanded folders depth-first', () => {
    const rows = buildTreeRows(entries, { a: false, 'a/sub': false });
    expect(rows.map(r => [r.item.key, r.depth])).toEqual([
      ['a', 0],
      ['a/x.png', 1],
      ['a/sub', 1],
      ['a/sub/01.png', 2],
      ['a/log.txt', 1],
      ['b', 0],
    ]);
  });
});

describe('effectiveSelection', () => {
  it('marks rows nested under a selected folder', () => {
    const rows = buildTreeRows(entries, { a: false, 'a/sub': false });
    expect(effectiveSelection(rows, new Set([2]))).toEqual([false, false, true, true, false, false]);
    expect(effectiveSelection(rows, new Set([0]))).toEqual([true, true, true, true, true, false]);
  });
});

describe('findRowIndex / ancestorKeys', () => {
  it('finds rows by key with a same-name fallback', () => {
    const rows = buildTreeRows(entries, { a: false });
    expect(findRowIndex(rows, 'a/log.txt')).toBe(3);
    expect(findRowIndex(rows, 'a\\x.png')).toBe(1);
    expect(findRowIndex(rows, 'a/other/X.PNG')).toBe(1);
    expect(findRowIndex(rows, 'zzz/q.png')).toBe(-1);
  });

  it('lists the folders to expand', () => {
    expect(ancestorKeys('a/sub/01.png')).toEqual(['a', 'a/sub']);
    expect(ancestorKeys('a')).toEqual([]);
  });
});

describe('planDeletion', () => {
  it('deletes whole archives and groups other entries by archive', () => {
    const plan = planDeletion([folder('b'), file('a/x.png', 'a'), folder('a/sub', 'a'), file('b/y.png', 'b')]);
    expect(plan.archives).toEqual(['b']);
    expect([...plan.contents]).toEqual([['a', ['x.png', 'sub']]]);
  });
});

describe('displayName / imagesUnder', () => {
  it('adds .png to extension-less files only', () => {
    expect(displayName({ item: file('a/noext', 'a'), depth: 1, isGroup: false, collapsed: true })).toBe('noext.png');
    expect(displayName({ item: folder('a/sub', 'a'), depth: 1, isGroup: true, collapsed: true })).toBe('sub');
  });

  it('collects files below a folder', () => {
    expect(imagesUnder(entries, 'a/sub').map(e => e.key)).toEqual(['a/sub/01.png']);
    expect(imagesUnder(entries, 'a').map(e => e.key)).toEqual(['a/x.png', 'a/sub/01.png', 'a/log.txt']);
  });
});

describe('selectedFiles / withoutTextFiles (Batch mode)', () => {
  const rows = buildTreeRows(entries, { a: false, 'a/sub': false });
  // rows: a, a/x.png, a/sub, a/sub/01.png, a/log.txt, b

  it('keeps files only, in tree order regardless of click order', () => {
    expect(selectedFiles(rows, new Set([3, 0, 1, 2])).map(e => e.key)).toEqual(['a/x.png', 'a/sub/01.png']);
  });

  it('returns nothing when only folders are selected', () => {
    expect(selectedFiles(rows, new Set([0, 5]))).toEqual([]);
  });

  it('removes text files', () => {
    expect(withoutTextFiles(selectedFiles(rows, new Set([4, 1]))).map(e => e.key)).toEqual(['a/x.png']);
  });
});
