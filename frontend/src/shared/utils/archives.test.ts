import { describe, expect, it } from 'vitest';
import {
  displayNameError,
  exportFileName,
  exportNameErrors,
  filterArchives,
  formatSize,
  imageFileName,
  savedPlace,
  serialNames,
  splitFileName,
} from './archives';

describe('imageFileName', () => {
  it('keeps the name of a page and puts the result folder in front of a result', () => {
    expect(imageFileName('20261002_200000_page/page.png')).toBe('page.png');
    expect(imageFileName('a/20261002_200310_背景除去/nobg.png')).toBe('20261002_200310_背景除去_nobg.png');
    expect(imageFileName('a/r/Inputs/Image1.png')).toBe('r_Inputs_Image1.png');
  });

  it('replaces characters a file name cannot have', () => {
    expect(imageFileName('a/x:y?.png')).toBe('x_y_.png');
  });
});

describe('savedPlace', () => {
  it('names the archive by its display name, followed by the result folder', () => {
    expect(savedPlace('20261002_200000_page/20261002_200310_背景除去', '第1話')).toBe(
      '第1話 / 20261002_200310_背景除去',
    );
    // A result saved as a new archive is the archive itself.
    expect(savedPlace('20261002_200310_背景除去', '背景除去')).toBe('背景除去');
  });
});

describe('displayNameError', () => {
  it('accepts a name with spaces around it', () => {
    expect(displayNameError('  第1話  ')).toBeNull();
  });

  it('refuses empty, too long and control characters', () => {
    expect(displayNameError('   ')).toMatch('入力');
    expect(displayNameError('x'.repeat(101))).toMatch('100 文字');
    expect(displayNameError('a\nb')).toMatch('使えない');
  });
});

describe('formatSize', () => {
  it('uses the largest unit below 1024', () => {
    expect(formatSize(980)).toBe('980 B');
    expect(formatSize(12.3 * 1024)).toBe('12.3 KB');
    expect(formatSize(4.5 * 1024 * 1024)).toBe('4.5 MB');
    expect(formatSize(1.2 * 1024 ** 3)).toBe('1.2 GB');
  });
});

describe('filterArchives', () => {
  const archives = [{ name: '第1話 線画' }, { name: '第2話 Color' }];

  it('matches every word, ignoring case', () => {
    expect(filterArchives(archives, '').length).toBe(2);
    expect(filterArchives(archives, 'color')).toEqual([{ name: '第2話 Color' }]);
    expect(filterArchives(archives, '第1話 線画')).toEqual([{ name: '第1話 線画' }]);
    expect(filterArchives(archives, '第1話 color')).toEqual([]);
  });
});

describe('export names', () => {
  it('splits the extension off and puts it back, usable as a file name', () => {
    expect(splitFileName('20261002_背景除去_nobg.png')).toEqual({ stem: '20261002_背景除去_nobg', ext: '.png' });
    expect(splitFileName('a.b.jpg')).toEqual({ stem: 'a.b', ext: '.jpg' });
    expect(splitFileName('noext')).toEqual({ stem: 'noext', ext: '' });
    expect(exportFileName(' 第1話: コマ1 ', '.png')).toBe('第1話_ コマ1.png');
  });

  it('refuses empty names and the same name twice (ignoring case)', () => {
    expect(
      exportNameErrors([
        { stem: 'コマ1', ext: '.png' },
        { stem: ' ', ext: '.png' },
        { stem: 'A', ext: '.png' },
        { stem: 'a', ext: '.PNG' },
        { stem: 'a', ext: '.jpg' },
      ]),
    ).toEqual([null, 'ファイル名を入力してください', '同じ名前があります', '同じ名前があります', null]);
  });
});

describe('serialNames', () => {
  it('puts "_<number>" after the name, two digits (three from 100)', () => {
    expect(serialNames('コマ', 1, 4)).toEqual(['コマ_01', 'コマ_02', 'コマ_03', 'コマ_04']);
    expect(serialNames('p', 99, 2)).toEqual(['p_099', 'p_100']);
  });

  it('puts the number where the "#"s are, as many digits as "#"s', () => {
    expect(serialNames('第1話_##', 1, 3)).toEqual(['第1話_01', '第1話_02', '第1話_03']);
    expect(serialNames('p#_final', 9, 2)).toEqual(['p9_final', 'p10_final']);
  });
});
