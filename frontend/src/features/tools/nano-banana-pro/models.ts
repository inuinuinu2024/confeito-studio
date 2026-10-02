/**
 * Gemini image models selectable in Nano Banana Pro and what each one supports (pure data).
 *
 * Source: Gemini API guide "Nano Banana image generation" — aspect ratio / size tables,
 * reference image limits, thinking levels and Google Search grounding per model.
 * Spec: docs/specs/tools/nano-banana-pro.md
 */
import type { ZoneDef } from '../gemini-image/reference-images';

export const OBJECT_ZONE = '高精度反映オブジェクト (Object)';
export const CHARACTER_ZONE = 'キャラクター一貫性 (Character)';
export const STYLE_ZONE = 'スタイル参照 (Style)';

const BASE_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const EXTREME_RATIOS = ['1:4', '4:1', '1:8', '8:1'];

/** Google Search grounding variants: web search, or web + image search. */
export type SearchMode = 'web' | 'web+image';

export interface ImageModel {
  id: string;
  /** Popular name the user picks from, e.g. "Nano Banana Pro". */
  nickname: string;
  /** Official name shown next to the selector, e.g. "Gemini 3 Pro Image". */
  officialName: string;
  /** One-line summary shown under the model selector. */
  description: string;
  aspectRatios: readonly string[];
  /** Selectable output sizes; empty = fixed output size (the size field is hidden). */
  imageSizes: readonly string[];
  /** Selectable thinking levels; empty = not configurable. */
  thinkingLevels: readonly string[];
  /** Gemini 3 image models always think, so thought summaries can be requested. */
  thinks: boolean;
  searchModes: readonly SearchMode[];
  /** Reference image drop zones and their limits. */
  zones: readonly ZoneDef[];
  /** Output pixel sizes when they differ from the Gemini 3 table (fixed-size models). */
  fixedDimensions?: Readonly<Record<string, readonly [number, number]>>;
}

export const DEFAULT_MODEL_ID = 'gemini-3-pro-image';

export const IMAGE_MODELS: readonly ImageModel[] = [
  {
    id: 'gemini-3-pro-image',
    nickname: 'Nano Banana Pro',
    officialName: 'Gemini 3 Pro Image',
    description: '高品質・複雑な指示向け。Thinking は常に有効で、思考レベルは変更できない。',
    aspectRatios: BASE_RATIOS,
    imageSizes: ['1K', '2K', '4K'],
    thinkingLevels: [],
    thinks: true,
    searchModes: ['web'],
    zones: [
      { title: OBJECT_ZONE, max: 6 },
      { title: CHARACTER_ZONE, max: 5 },
      { title: STYLE_ZONE, max: 3 },
    ],
  },
  {
    id: 'gemini-3.1-flash-image',
    nickname: 'Nano Banana 2',
    officialName: 'Gemini 3.1 Flash Image',
    description: '速度と品質のバランス型。512 サイズ、1:8 などの縦横比、画像検索に対応。',
    aspectRatios: [...BASE_RATIOS, ...EXTREME_RATIOS],
    imageSizes: ['512', '1K', '2K', '4K'],
    thinkingLevels: ['minimal', 'high'],
    thinks: true,
    searchModes: ['web', 'web+image'],
    zones: [
      { title: OBJECT_ZONE, max: 10 },
      { title: CHARACTER_ZONE, max: 4 },
    ],
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    nickname: 'Nano Banana 2 Lite',
    officialName: 'Gemini 3.1 Flash Lite Image',
    description: '最速・最安。サイズは 1K のみ。Google 検索は使えない。',
    aspectRatios: BASE_RATIOS,
    imageSizes: ['1K'],
    thinkingLevels: ['minimal', 'high'],
    thinks: true,
    searchModes: [],
    zones: [{ title: OBJECT_ZONE, max: 14 }],
  },
  {
    id: 'gemini-2.5-flash-image',
    nickname: 'Nano Banana',
    officialName: 'Gemini 2.5 Flash Image',
    description: '旧世代。出力は約 1024px 固定。参照画像は 3 枚までが推奨。',
    aspectRatios: BASE_RATIOS,
    imageSizes: [],
    thinkingLevels: [],
    thinks: false,
    searchModes: [],
    zones: [{ title: OBJECT_ZONE, max: 3 }],
    fixedDimensions: {
      '1:1': [1024, 1024],
      '2:3': [832, 1248],
      '3:2': [1248, 832],
      '3:4': [864, 1184],
      '4:3': [1184, 864],
      '4:5': [896, 1152],
      '5:4': [1152, 896],
      '9:16': [768, 1344],
      '16:9': [1344, 768],
      '21:9': [1536, 672],
    },
  },
];

export function findModel(id: string): ImageModel {
  return IMAGE_MODELS.find(m => m.id === id) ?? IMAGE_MODELS[0];
}

/**
 * Removes (in place) reference images whose zone the model does not have or that exceed the
 * zone's limit, keeping the order of the rest. Returns how many were removed.
 */
export function fitImagesToZones(images: { zoneTitle: string }[], zones: readonly ZoneDef[]): number {
  const used = new Map<string, number>();
  const kept = images.filter(image => {
    const zone = zones.find(z => z.title === image.zoneTitle);
    const count = used.get(image.zoneTitle) ?? 0;
    if (!zone || count >= zone.max) return false;
    used.set(image.zoneTitle, count + 1);
    return true;
  });
  const removed = images.length - kept.length;
  images.splice(0, images.length, ...kept);
  return removed;
}

/** 1K output sizes of the Gemini 3 image models; 512 / 2K / 4K are 0.5x / 2x / 4x of these. */
const DIMENSIONS_1K: Record<string, readonly [number, number]> = {
  '1:1': [1024, 1024],
  '2:3': [848, 1264],
  '3:2': [1264, 848],
  '3:4': [896, 1200],
  '4:3': [1200, 896],
  '4:5': [928, 1152],
  '5:4': [1152, 928],
  '9:16': [768, 1376],
  '16:9': [1376, 768],
  '21:9': [1584, 672],
  '1:4': [512, 2048],
  '4:1': [2048, 512],
  '1:8': [384, 3072],
  '8:1': [3072, 384],
};

const SIZE_SCALE: Record<string, number> = { '512': 0.5, '1K': 1, '2K': 2, '4K': 4 };

/** Output pixel size for the model / aspect ratio / size, or null when unknown. */
export function outputSize(model: ImageModel, aspectRatio: string, imageSize: string): [number, number] | null {
  const fixed = model.fixedDimensions?.[aspectRatio];
  if (fixed) return [fixed[0], fixed[1]];
  const base = DIMENSIONS_1K[aspectRatio];
  const scale = SIZE_SCALE[imageSize];
  return base && scale ? [base[0] * scale, base[1] * scale] : null;
}
