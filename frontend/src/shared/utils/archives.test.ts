import { describe, expect, it } from 'vitest';
import { displayNameError, filterArchives, formatSize, imageFileName } from './archives';

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
