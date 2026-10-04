import { describe, expect, it } from 'vitest';
import type { CharacterStore } from '../api/characters';
import { displayCategories, nameCategoryError } from './categories';
import {
  appendToPrompt,
  type EditorImage,
  groupCharacters,
  referenceDescriptions,
  sameIcon,
  sameImages,
} from './characters';

const store: CharacterStore = {
  categories: ['主要', 'モブ'],
  characters: [
    { id: 'a', name: '花子', category: '主要', text: '黒髪ボブ', images: ['1.png'], image_texts: {}, icon: null },
    { id: 'b', name: '太郎', category: '主要', text: '', images: [], image_texts: {}, icon: null },
    { id: 'c', name: '店員', category: 'モブ', text: 'エプロン', images: [], image_texts: {}, icon: null },
    { id: 'd', name: '猫', category: '', text: '', images: ['2.png', '3.jpg'], image_texts: {}, icon: null },
  ],
};

describe('groupCharacters', () => {
  it('groups by category in order with 未分類 last, searching the name and the text', () => {
    expect(groupCharacters(store, null, '').map(g => [g.category, g.items.map(c => c.id)])).toEqual([
      ['主要', ['a', 'b']],
      ['モブ', ['c']],
      ['', ['d']],
    ]);
    expect(groupCharacters(store, null, 'ボブ').flatMap(g => g.items.map(c => c.id))).toEqual(['a']);
    expect(groupCharacters(store, '主要', '太').flatMap(g => g.items.map(c => c.id))).toEqual(['b']);
    expect(displayCategories(store.categories, store.characters)).toEqual(['主要', 'モブ', '']);
  });
});

describe('nameCategoryError', () => {
  it('only needs a name', () => {
    expect(nameCategoryError(' 花子 ', '')).toBeNull();
    expect(nameCategoryError(' ', '')).toBe('名前を入力してください。');
    expect(nameCategoryError('a', 'x'.repeat(51))).toMatch('50 文字以内');
  });
});

describe('sameImages', () => {
  it('compares saved files by name and new files by identity', () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const a: EditorImage[] = [
      { saved: '1.png', text: '' },
      { file, text: '' },
    ];
    expect(
      sameImages(a, [
        { saved: '1.png', text: '' },
        { file, text: '' },
      ]),
    ).toBe(true);
    expect(
      sameImages(a, [
        { file, text: '' },
        { saved: '1.png', text: '' },
      ]),
    ).toBe(false);
    expect(
      sameImages(a, [
        { saved: '1.png', text: '' },
        { file: new File(['x'], 'x.png'), text: '' },
      ]),
    ).toBe(false);
    expect(sameImages(a, [{ saved: '1.png', text: '' }])).toBe(false);
  });

  it('compares the image texts too', () => {
    expect(sameImages([{ saved: 'a.png', text: '正面' }], [{ saved: 'a.png', text: '' }])).toBe(false);
  });
});

describe('referenceDescriptions', () => {
  it('labels every image, puts the text on the first one and each image text on its image', () => {
    expect(referenceDescriptions('花子', ' 黒髪 \n', ['正面', '', ' 横顔 '])).toEqual([
      'キャラクター「花子」\n黒髪\n正面',
      'キャラクター「花子」',
      'キャラクター「花子」\n横顔',
    ]);
    expect(referenceDescriptions('猫', '  ', [''])).toEqual(['キャラクター「猫」']);
  });
});

describe('appendToPrompt', () => {
  it('adds the text after a blank line', () => {
    expect(appendToPrompt('着彩して\n', ' 黒髪 ')).toBe('着彩して\n\n黒髪');
    expect(appendToPrompt('  ', '黒髪')).toBe('黒髪');
  });
});

describe('sameIcon', () => {
  it('compares saved icons by name and new ones by identity', () => {
    const blob = new Blob(['x']);
    expect(sameIcon(null, null)).toBe(true);
    expect(sameIcon({ saved: 'icon-a.png' }, { saved: 'icon-a.png' })).toBe(true);
    expect(sameIcon({ saved: 'icon-a.png' }, null)).toBe(false);
    expect(sameIcon({ blob }, { blob })).toBe(true);
    expect(sameIcon({ blob }, { blob: new Blob(['x']) })).toBe(false);
  });
});
