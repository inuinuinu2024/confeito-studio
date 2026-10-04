import { describe, expect, it } from 'vitest';
import { fitWithin, imageHeading } from './payload';
import {
  characterZone,
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

  it('takes a smaller total limit (one slot used by the 原画)', () => {
    expect(zoneForNewImage(images(OBJECT, OBJECT), zones, 2)).toBeNull();
    const list = images(OBJECT, STYLE, OBJECT);
    expect(fitImagesToModel(list, zones, 2)).toEqual({ retyped: 0, removed: 1 });
    expect(list.map(i => i.n)).toEqual([0, 1]);
  });

  it('scales images down to the upload limit on the longest side, never up', () => {
    expect(fitWithin(3000, 1000)).toEqual([2048, 683]);
    expect(fitWithin(1000, 6000)).toEqual([341, 2048]);
    expect(fitWithin(2048, 1536)).toEqual([2048, 1536]);
    expect(fitWithin(500, 300)).toEqual([500, 300]);
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

  it("gives a registered character's images the Character type, else the first type", () => {
    expect(
      characterZone([
        { title: OBJECT, max: 6 },
        { title: CHARACTER, max: 5 },
      ])?.title,
    ).toBe(CHARACTER);
    expect(characterZone(zones)?.title).toBe(OBJECT);
    expect(characterZone([])).toBeUndefined();
  });
});
