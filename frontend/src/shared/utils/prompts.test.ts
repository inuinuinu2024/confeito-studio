import { describe, expect, it } from 'vitest';
import type { PromptStore } from '../api/prompts';
import {
  countByCategory,
  countImportConflicts,
  displayCategories,
  exportData,
  findByName,
  groupPrompts,
  isSortable,
  MAX_NAME_LENGTH,
  normalizeCategory,
  parseImportFile,
  previewText,
  promptInputError,
} from './prompts';

const store: PromptStore = {
  categories: ['着彩', '背景'],
  prompts: [
    { id: 'a', name: '着彩', category: '着彩', text: '着彩して' },
    { id: 'b', name: 'ベタ塗り', category: '着彩', text: 'Flat colors' },
    { id: 'c', name: '夕焼け', category: '背景', text: '空をオレンジに' },
    { id: 'd', name: '表情差分', category: '', text: '表情を変えて' },
  ],
};

describe('promptInputError', () => {
  it('accepts a name, a category and a text', () => {
    expect(promptInputError(' 着彩 ', '', '着彩して')).toBeNull();
  });

  it('needs a name and a category within the limits and a text', () => {
    expect(promptInputError('  ', '', 'text')).toBe('名前を入力してください。');
    expect(promptInputError('x'.repeat(MAX_NAME_LENGTH + 1), '', 'text')).toBe('名前は 100 文字以内にしてください。');
    expect(promptInputError('x'.repeat(MAX_NAME_LENGTH), '', 'text')).toBeNull();
    expect(promptInputError('name', 'x'.repeat(51), 'text')).toBe('カテゴリーは 50 文字以内にしてください。');
    expect(promptInputError('name', '', ' \n ')).toBe('プロンプトの本文を入力してください。');
  });
});

describe('normalizeCategory', () => {
  it('trims and treats 未分類 as no category', () => {
    expect(normalizeCategory(' 着彩 ')).toBe('着彩');
    expect(normalizeCategory(' 未分類 ')).toBe('');
  });
});

describe('findByName', () => {
  it('compares the trimmed name and skips the prompt being edited', () => {
    expect(findByName(store.prompts, ' 着彩 ')?.id).toBe('a');
    expect(findByName(store.prompts, '着')).toBeUndefined();
    expect(findByName(store.prompts, '着彩', 'a')).toBeUndefined();
  });
});

describe('previewText', () => {
  it('shows the first non-blank lines', () => {
    expect(previewText('one\n\ntwo\r\nthree')).toBe('one\ntwo…');
    expect(previewText('one\ntwo')).toBe('one\ntwo');
  });
});

describe('categories and groups', () => {
  it('lists 未分類 last, only when used', () => {
    expect(displayCategories(store)).toEqual(['着彩', '背景', '']);
    expect(displayCategories({ ...store, prompts: store.prompts.slice(0, 3) })).toEqual(['着彩', '背景']);
    expect(countByCategory(store)).toEqual(
      new Map([
        ['着彩', 2],
        ['背景', 1],
        ['', 1],
      ]),
    );
  });

  it('groups by category for すべて and filters by one category', () => {
    expect(groupPrompts(store, null, '').map(g => [g.category, g.prompts.map(p => p.id)])).toEqual([
      ['着彩', ['a', 'b']],
      ['背景', ['c']],
      ['', ['d']],
    ]);
    expect(groupPrompts(store, '', '').map(g => g.prompts.map(p => p.id))).toEqual([['d']]);
  });

  it('searches the name and the text, case-insensitively', () => {
    expect(groupPrompts(store, null, 'flat').flatMap(g => g.prompts.map(p => p.id))).toEqual(['b']);
    expect(groupPrompts(store, null, 'オレンジ').flatMap(g => g.prompts.map(p => p.id))).toEqual(['c']);
    expect(groupPrompts(store, '着彩', '空')).toEqual([]);
  });

  it('sorts only within one category without a search', () => {
    expect(isSortable('着彩', '')).toBe(true);
    expect(isSortable('', ' ')).toBe(true);
    expect(isSortable(null, '')).toBe(false);
    expect(isSortable('着彩', 'x')).toBe(false);
  });
});

describe('export / import', () => {
  it('exports names, categories and texts without ids', () => {
    expect(exportData(store)).toEqual({
      format: 'confeito-prompts',
      version: 1,
      categories: ['着彩', '背景'],
      prompts: store.prompts.map(({ name, category, text }) => ({ name, category, text })),
    });
  });

  it('reads an exported file back', () => {
    const file = parseImportFile(JSON.stringify(exportData(store)));
    expect(file.categories).toEqual(['着彩', '背景']);
    expect(file.prompts).toHaveLength(4);
    expect(parseImportFile('{"prompts": []}')).toEqual({ prompts: [], categories: [] });
  });

  it('rejects files without prompts', () => {
    expect(() => parseImportFile('{broken')).toThrow('JSON として読めない');
    expect(() => parseImportFile('{"nanoBananaPro": []}')).toThrow('prompts');
    expect(() => parseImportFile('[]')).toThrow('prompts');
  });

  it('counts names already registered or repeated in the file', () => {
    const items = [
      { name: ' 着彩 ', text: 'x' },
      { name: '新しい', text: 'x' },
      { name: '新しい', text: 'y' },
      { name: '夕焼け', text: ' ' },
      'bad',
    ];
    expect(countImportConflicts(store.prompts, items)).toBe(2);
  });
});
