import { describe, expect, it } from 'vitest';
import { imageHeading } from './payload';
import {
  fitImagesToModel,
  reorderImages,
  totalLimit,
  zoneForNewImage,
  zoneLabel,
  zoneShortName,
} from './reference-list';

const OBJECT = '高精度反映オブジェクト (Object)';
const CHARACTER = 'キャラクター一貫性 (Character)';
const STYLE = 'スタイル参照 (Style)';
const zones = [
  { title: OBJECT, max: 2 },
  { title: STYLE, max: 1 },
];
const images = (...types: string[]) => types.map((zoneTitle, n) => ({ zoneTitle, n }));

describe('reference list', () => {
  it('names a type for the prompt and for the counters', () => {
    expect(zoneLabel(STYLE)).toBe('スタイル参照');
    expect(zoneShortName(STYLE)).toBe('Style');
  });

  it('limits only the total: the sum of the per-type numbers', () => {
    expect(totalLimit(zones)).toBe(3);
    expect(zoneForNewImage(images(), zones)?.title).toBe(OBJECT);
    expect(zoneForNewImage(images(OBJECT, OBJECT), zones)?.title).toBe(STYLE);
    // Every type at its recommended number but the total not reached -> the first type.
    expect(zoneForNewImage(images(STYLE, STYLE), zones)?.title).toBe(OBJECT);
    expect(zoneForNewImage(images(STYLE, STYLE, STYLE), zones)).toBeNull();
  });

  it('fits the list to another model: unknown types become the first type, extras go from the end', () => {
    const list = images(OBJECT, CHARACTER, STYLE, OBJECT, STYLE);
    expect(fitImagesToModel(list, zones)).toEqual({ retyped: 1, removed: 2 });
    expect(list).toEqual([
      { zoneTitle: OBJECT, n: 0 },
      { zoneTitle: OBJECT, n: 1 },
      { zoneTitle: STYLE, n: 2 },
    ]);
  });

  it('reorders in place only with the same items', () => {
    const [a, b, c] = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const list = [a, b, c];
    reorderImages(list, [c, a, b]);
    expect(list).toEqual([c, a, b]);
    reorderImages(list, [a, b]);
    expect(list).toEqual([c, a, b]);
  });

  it('puts the description under the image heading', () => {
    expect(imageHeading(1, { zoneTitle: OBJECT, isImportant: true, description: '主人公の線画。形を保つこと。' })).toBe(
      '# Image 1\nこの画像を高精度反映オブジェクト画像とする。\nこれはユーザにより重要画像に設定されている。\n主人公の線画。形を保つこと。\n\n',
    );
    expect(imageHeading(2, { zoneTitle: STYLE, description: '  ' })).toBe(
      '# Image 2\nこの画像をスタイル参照画像とする。\n\n',
    );
  });
});
