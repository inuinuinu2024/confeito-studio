import { describe, expect, it } from 'vitest';
import {
  CHARACTER_ZONE,
  findModel,
  fitImagesToZones,
  IMAGE_MODELS,
  OBJECT_ZONE,
  outputSize,
  STYLE_ZONE,
} from './models';
import { effectiveValue, isAvailable, resolveOptions, SETTINGS, type SettingsReader, UNSET } from './options';

const PRO = findModel('gemini-3-pro-image');
const FLASH = findModel('gemini-3.1-flash-image');
const LITE = findModel('gemini-3.1-flash-lite-image');
const LEGACY = findModel('gemini-2.5-flash-image');

const reader =
  (stored: Record<string, string>): SettingsReader =>
  (key, fallback) =>
    stored[key] || fallback;

const setting = (key: string) => SETTINGS.find(s => s.key === key)!;
const visible = (model = PRO, api: 'interactions' | 'generateContent' = 'interactions') =>
  SETTINGS.filter(s => isAvailable(s, model, api)).map(s => s.key);

describe('models', () => {
  it('pairs each nickname with its official name and model id', () => {
    expect(IMAGE_MODELS.map(m => [m.nickname, m.officialName, m.id])).toEqual([
      ['Nano Banana Pro', 'Gemini 3 Pro Image', 'gemini-3-pro-image'],
      ['Nano Banana 2', 'Gemini 3.1 Flash Image', 'gemini-3.1-flash-image'],
      ['Nano Banana 2 Lite', 'Gemini 3.1 Flash Lite Image', 'gemini-3.1-flash-lite-image'],
      ['Nano Banana', 'Gemini 2.5 Flash Image', 'gemini-2.5-flash-image'],
    ]);
  });

  it('falls back to Nano Banana Pro for an unknown id', () => {
    expect(findModel('nope').id).toBe('gemini-3-pro-image');
  });

  it('uses the documented output sizes', () => {
    expect(outputSize(PRO, '16:9', '1K')).toEqual([1376, 768]);
    expect(outputSize(PRO, '21:9', '4K')).toEqual([6336, 2688]);
    expect(outputSize(FLASH, '1:8', '512')).toEqual([192, 1536]);
    expect(outputSize(LEGACY, '16:9', '')).toEqual([1344, 768]);
    expect(outputSize(PRO, 'unset', '1K')).toBeNull();
  });

  it('drops reference images the model has no room for, keeping the order', () => {
    const images = [
      { zoneTitle: OBJECT_ZONE, n: 1 },
      { zoneTitle: STYLE_ZONE, n: 2 },
      { zoneTitle: CHARACTER_ZONE, n: 3 },
      { zoneTitle: OBJECT_ZONE, n: 4 },
    ];
    expect(
      fitImagesToZones(images, [
        { title: OBJECT_ZONE, max: 1 },
        { title: CHARACTER_ZONE, max: 4 },
      ]),
    ).toBe(2);
    expect(images.map(i => i.n)).toEqual([1, 3]);
  });
});

describe('available settings', () => {
  it('Interactions has no safety or sampling settings', () => {
    expect(visible(PRO, 'interactions')).toEqual([
      'aspectRatio',
      'imageSize',
      'mimeType',
      'thoughts',
      'seed',
      'systemInstruction',
      'search',
      'store',
      'serviceTier',
    ]);
  });

  it('generateContent adds modalities, sampling and safety settings', () => {
    const keys = visible(PRO, 'generateContent');
    expect(keys).toContain('responseModalities');
    expect(keys).toEqual(expect.arrayContaining(['temperature', 'topP', 'topK', 'safety_HARM_CATEGORY_JAILBREAK']));
  });

  it('follows the model capabilities', () => {
    expect(visible(PRO)).not.toContain('thinkingLevel');
    expect(visible(FLASH)).toContain('thinkingLevel');
    expect(visible(LITE)).not.toContain('search');
    expect(visible(LEGACY)).not.toContain('imageSize');
    expect(visible(LEGACY)).not.toContain('thoughts');
  });
});

describe('effectiveValue', () => {
  it('keeps what the tool sent before when nothing is stored', () => {
    const read = reader({});
    expect(effectiveValue(setting('aspectRatio'), read, PRO, 'interactions')).toBe('1:1');
    expect(effectiveValue(setting('imageSize'), read, PRO, 'interactions')).toBe('1K');
    expect(effectiveValue(setting('mimeType'), read, PRO, 'interactions')).toBe('image/png');
    expect(effectiveValue(setting('seed'), read, PRO, 'interactions')).toBe('');
  });

  it('treats values the model / API does not support as unset', () => {
    const read = reader({ aspectRatio: '1:8', imageSize: '512', mimeType: 'image/png' });
    expect(effectiveValue(setting('aspectRatio'), read, PRO, 'interactions')).toBe(UNSET);
    expect(effectiveValue(setting('aspectRatio'), read, FLASH, 'interactions')).toBe('1:8');
    expect(effectiveValue(setting('imageSize'), read, LITE, 'interactions')).toBe(UNSET);
    expect(effectiveValue(setting('mimeType'), read, PRO, 'generateContent')).toBe(UNSET);
  });

  it('ignores numbers out of range', () => {
    expect(effectiveValue(setting('temperature'), reader({ temperature: '2.5' }), PRO, 'generateContent')).toBe('');
    expect(effectiveValue(setting('seed'), reader({ seed: '1.5' }), PRO, 'interactions')).toBe('');
    expect(effectiveValue(setting('seed'), reader({ seed: ' 42 ' }), PRO, 'interactions')).toBe('42');
  });
});

describe('resolveOptions', () => {
  it('resolves only what was chosen', () => {
    expect(
      resolveOptions(reader({ aspectRatio: UNSET, imageSize: UNSET, mimeType: UNSET }), PRO, 'interactions'),
    ).toEqual(
      Object.fromEntries(Object.keys(resolveOptions(reader({}), PRO, 'interactions')).map(k => [k, undefined])),
    );
  });

  it('maps every kind of setting', () => {
    const read = reader({
      aspectRatio: '4:1',
      imageSize: '512',
      mimeType: 'image/jpeg',
      responseModalities: 'TEXT,IMAGE',
      thinkingLevel: 'high',
      thoughts: 'exclude',
      temperature: '0.4',
      topK: '40',
      seed: '7',
      safety_HARM_CATEGORY_HARASSMENT: 'OFF',
      safety_HARM_CATEGORY_JAILBREAK: 'BLOCK_ONLY_HIGH',
      systemInstruction: 'Draw.\n',
      search: 'web+image',
      store: 'false',
      serviceTier: 'flex',
    });
    expect(resolveOptions(read, FLASH, 'generateContent')).toEqual({
      aspectRatio: '4:1',
      imageSize: '512',
      mimeType: 'image/jpeg',
      responseModalities: ['TEXT', 'IMAGE'],
      thinkingLevel: 'high',
      includeThoughts: false,
      temperature: 0.4,
      topP: undefined,
      topK: 40,
      seed: 7,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'BLOCK_ONLY_HIGH' },
      ],
      systemInstruction: 'Draw.\n',
      search: 'web+image',
      store: false,
      serviceTier: 'flex',
    });

    // The same settings on Interactions + Pro: unsupported ones are left out.
    const pro = resolveOptions(read, PRO, 'interactions');
    expect(pro).toMatchObject({ mimeType: 'image/jpeg', includeThoughts: false, seed: 7, store: false });
    expect(pro.aspectRatio).toBeUndefined();
    expect(pro.imageSize).toBeUndefined();
    expect(pro.thinkingLevel).toBeUndefined();
    expect(pro.temperature).toBeUndefined();
    expect(pro.safetySettings).toBeUndefined();
    expect(pro.search).toBeUndefined();
  });
});
