/**
 * Nano Banana画像生成 tool settings per model × API (pure, unit tested).
 *
 * Every setting is stored as a string under `nanoBananaPro_<key>`. UNSET means
 * "既定（送らない）": the field is left out of the request. A stored value that the
 * selected model / API does not support counts as UNSET; it is kept, so switching back restores it.
 * Spec: docs/specs/tools/nano-banana-pro.md
 */
import type { Option } from '../../../shared/ui/form';
import type { ImageModel, SearchMode } from './models';
import type { GenerationOptions, SafetySetting } from './request';

export type GeminiApi = 'interactions' | 'generateContent';

export const APIS: readonly { value: GeminiApi; label: string }[] = [
  { value: 'interactions', label: 'Interactions API' },
  { value: 'generateContent', label: 'generateContent API' },
];

export const DEFAULT_API: GeminiApi = 'interactions';

export function toApi(value: string): GeminiApi {
  return value === 'generateContent' ? 'generateContent' : 'interactions';
}

export const UNSET = 'unset';
export const UNSET_LABEL = '既定（送らない）';

export type Section = 'output' | 'thinking' | 'safety' | 'context' | 'service';

export const SECTIONS: readonly { id: Section; title: string }[] = [
  { id: 'output', title: '出力' },
  { id: 'thinking', title: '思考・サンプリング' },
  { id: 'safety', title: '安全設定' },
  { id: 'context', title: 'システム指示・ツール' },
  { id: 'service', title: 'API オプション' },
];

interface BaseSetting {
  key: string;
  label: string;
  help: string;
  section: Section;
  /** Request field per API; an API without an entry does not have the setting. */
  paths: Partial<Record<GeminiApi, string>>;
}

export interface ChoiceSetting extends BaseSetting {
  kind: 'choice';
  /** Value used when nothing is stored: UNSET, or what the tool always sent before. */
  initial: string;
  /** Selectable values for the model / API (UNSET is always offered too); empty hides the field. */
  options(model: ImageModel, api: GeminiApi): Option[];
  widget?: 'aspect-ratio' | 'image-size';
}

export interface NumberSetting extends BaseSetting {
  kind: 'number';
  min: number;
  max: number;
  integer: boolean;
}

export interface TextSetting extends BaseSetting {
  kind: 'text';
}

export type Setting = ChoiceSetting | NumberSetting | TextSetting;

const opts = (...pairs: [value: string, label: string][]): Option[] =>
  pairs.map(([value, label]) => ({ value, label }));

export const HARM_CATEGORIES: readonly { category: string; label: string }[] = [
  { category: 'HARM_CATEGORY_HARASSMENT', label: 'ハラスメント' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', label: 'ヘイトスピーチ' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', label: '性的表現' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', label: '危険なコンテンツ' },
  { category: 'HARM_CATEGORY_JAILBREAK', label: 'ジェイルブレイク' },
];

const THRESHOLDS = opts(
  ['BLOCK_LOW_AND_ABOVE', 'BLOCK_LOW_AND_ABOVE（低以上をブロック）'],
  ['BLOCK_MEDIUM_AND_ABOVE', 'BLOCK_MEDIUM_AND_ABOVE（中以上をブロック）'],
  ['BLOCK_ONLY_HIGH', 'BLOCK_ONLY_HIGH（高のみブロック）'],
  ['BLOCK_NONE', 'BLOCK_NONE（ブロックしない）'],
  ['OFF', 'OFF（フィルタを無効化）'],
);

export const safetyKey = (category: string) => `safety_${category}`;

const SEARCH_LABELS: Record<GeminiApi, Record<SearchMode, string>> = {
  interactions: { web: 'ウェブ検索', 'web+image': 'ウェブ検索 + 画像検索 (web_search, image_search)' },
  generateContent: { web: 'ウェブ検索', 'web+image': 'ウェブ検索 + 画像検索 (webSearch, imageSearch)' },
};

export const SETTINGS: readonly Setting[] = [
  {
    kind: 'choice',
    key: 'aspectRatio',
    label: 'アスペクト比',
    help: '出力画像の縦横比。既定では参照画像に合わせるか 1:1 になる。',
    section: 'output',
    paths: {
      interactions: 'response_format.aspect_ratio',
      generateContent: 'generationConfig.imageConfig.aspectRatio',
    },
    initial: '1:1',
    options: model => model.aspectRatios.map(r => ({ value: r, label: r })),
    widget: 'aspect-ratio',
  },
  {
    kind: 'choice',
    key: 'imageSize',
    label: '画像サイズ',
    help: '出力解像度。既定は 1K。',
    section: 'output',
    paths: { interactions: 'response_format.image_size', generateContent: 'generationConfig.imageConfig.imageSize' },
    initial: '1K',
    options: model => model.imageSizes.map(s => ({ value: s, label: s })),
    widget: 'image-size',
  },
  {
    kind: 'choice',
    key: 'mimeType',
    label: '出力形式',
    help: '生成画像の形式。保存するファイルの拡張子は、実際に返ってきた画像の形式で決まる。',
    section: 'output',
    paths: {
      interactions: 'response_format.mime_type',
      generateContent: 'generationConfig.responseFormat.image.mimeType',
    },
    initial: 'image/png',
    options: (_model, api) =>
      api === 'interactions'
        ? opts(['image/png', 'PNG (image/png)'], ['image/jpeg', 'JPEG (image/jpeg)'])
        : opts(['image/jpeg', 'JPEG (IMAGE_JPEG)']),
  },
  {
    kind: 'choice',
    key: 'responseModalities',
    label: '応答の種類',
    help: 'モデルが返すもの。既定では画像と説明文の両方が返ることがある（保存するのは画像だけ）。',
    section: 'output',
    paths: { generateContent: 'generationConfig.responseModalities' },
    initial: UNSET,
    options: () => opts(['IMAGE', '画像のみ ["IMAGE"]'], ['TEXT,IMAGE', 'テキストと画像 ["TEXT", "IMAGE"]']),
  },
  {
    kind: 'choice',
    key: 'thinkingLevel',
    label: '思考レベル',
    help: '生成前に考える量。既定は minimal。high は品質が上がる代わりに遅くなる。',
    section: 'thinking',
    paths: {
      interactions: 'generation_config.thinking_level',
      generateContent: 'generationConfig.thinkingConfig.thinkingLevel',
    },
    initial: UNSET,
    options: (model, api) =>
      model.thinkingLevels.map(l => ({ value: l, label: api === 'interactions' ? l : l.toUpperCase() })),
  },
  {
    kind: 'choice',
    key: 'thoughts',
    label: '思考の要約',
    help: '応答に思考の要約を含めるか。生成される画像には影響しない。',
    section: 'thinking',
    paths: {
      interactions: 'generation_config.thinking_summaries',
      generateContent: 'generationConfig.thinkingConfig.includeThoughts',
    },
    initial: UNSET,
    options: (model, api) =>
      !model.thinks
        ? []
        : api === 'interactions'
          ? opts(['include', 'auto（含める）'], ['exclude', 'none（含めない）'])
          : opts(['include', 'true（含める）'], ['exclude', 'false（含めない）']),
  },
  {
    kind: 'number',
    key: 'temperature',
    label: 'temperature',
    help: '出力のランダムさ（0〜2）。既定値はモデルごとに異なる。',
    section: 'thinking',
    paths: { generateContent: 'generationConfig.temperature' },
    min: 0,
    max: 2,
    integer: false,
  },
  {
    kind: 'number',
    key: 'topP',
    label: 'topP',
    help: '累積確率がこの値に達するまでの候補から選ぶ（0〜1）。',
    section: 'thinking',
    paths: { generateContent: 'generationConfig.topP' },
    min: 0,
    max: 1,
    integer: false,
  },
  {
    kind: 'number',
    key: 'topK',
    label: 'topK',
    help: '確率の高い上位 K 個の候補から選ぶ（1 以上の整数）。モデルによっては指定できない。',
    section: 'thinking',
    paths: { generateContent: 'generationConfig.topK' },
    min: 1,
    max: 1_000_000,
    integer: true,
  },
  {
    kind: 'number',
    key: 'seed',
    label: 'seed',
    help: '乱数のシード（0 以上の整数）。同じ入力と seed で結果を再現しやすくなる。既定では毎回ランダム。',
    section: 'thinking',
    paths: { interactions: 'generation_config.seed', generateContent: 'generationConfig.seed' },
    min: 0,
    max: 2_147_483_647,
    integer: true,
  },
  ...HARM_CATEGORIES.map(({ category, label }): ChoiceSetting => ({
    kind: 'choice',
    key: safetyKey(category),
    label: `${label} (${category.replace('HARM_CATEGORY_', '')})`,
    help: `${category} のブロックしきい値。既定は API 側の設定（Gemini 2.5 / 3 では OFF）。`,
    section: 'safety',
    paths: { generateContent: 'safetySettings[]' },
    initial: UNSET,
    options: () => THRESHOLDS,
  })),
  {
    kind: 'text',
    key: 'systemInstruction',
    label: 'システム指示',
    help: 'プロンプトとは別にモデルへ渡す指示（テキストのみ）。空なら送らない。',
    section: 'context',
    paths: { interactions: 'system_instruction', generateContent: 'systemInstruction.parts[].text' },
  },
  {
    kind: 'choice',
    key: 'search',
    label: 'Google 検索',
    help: 'Google 検索の結果を使って生成する（グラウンディング）。検索の料金が別途かかる。',
    section: 'context',
    paths: { interactions: 'tools[].google_search', generateContent: 'tools[].googleSearch' },
    initial: UNSET,
    options: (model, api) => model.searchModes.map(mode => ({ value: mode, label: SEARCH_LABELS[api][mode] })),
  },
  {
    kind: 'choice',
    key: 'store',
    label: 'store',
    help: 'Interactions: リクエストと応答を保存するか（既定 true、有料 55 日・無料 1 日保持）。generateContent: ログ記録の設定（プロジェクト設定より優先）。',
    section: 'service',
    paths: { interactions: 'store', generateContent: 'store' },
    initial: UNSET,
    options: () => opts(['true', 'true'], ['false', 'false']),
  },
  {
    kind: 'choice',
    key: 'serviceTier',
    label: 'service tier',
    help: '処理の優先度と料金。flex は安いが遅く失敗しやすい、priority は高いが速い。既定は standard。',
    section: 'service',
    paths: { interactions: 'service_tier', generateContent: 'serviceTier' },
    initial: UNSET,
    options: () => opts(['standard', 'standard'], ['flex', 'flex'], ['priority', 'priority']),
  },
];

export function isAvailable(setting: Setting, model: ImageModel, api: GeminiApi): boolean {
  if (!setting.paths[api]) return false;
  return setting.kind !== 'choice' || setting.options(model, api).length > 0;
}

/** Reads a stored setting: `read(key, fallback)` returns the fallback when nothing is stored. */
export type SettingsReader = (key: string, fallback: string) => string;

/** The stored value if the model / API supports it; otherwise UNSET (choice) or '' (number, text). */
export function effectiveValue(setting: Setting, read: SettingsReader, model: ImageModel, api: GeminiApi): string {
  if (setting.kind === 'choice') {
    const value = read(setting.key, setting.initial);
    if (!isAvailable(setting, model, api)) return UNSET;
    return setting.options(model, api).some(o => o.value === value) ? value : UNSET;
  }
  if (!isAvailable(setting, model, api)) return '';
  const raw = read(setting.key, '');
  if (setting.kind === 'text') return raw.trim() ? raw : '';
  return parseNumber(raw, setting) === undefined ? '' : raw.trim();
}

export function parseNumber(raw: string, setting: NumberSetting): number | undefined {
  if (raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < setting.min || value > setting.max) return undefined;
  if (setting.integer && !Number.isInteger(value)) return undefined;
  return value;
}

function settingByKey<K extends Setting['kind']>(key: string, kind: K): Extract<Setting, { kind: K }> {
  const setting = SETTINGS.find(s => s.key === key && s.kind === kind);
  if (!setting) throw new Error(`Unknown setting: ${key}`);
  return setting as Extract<Setting, { kind: K }>;
}

/** Resolves the stored settings into request options for the model / API (unsupported → left out). */
export function resolveOptions(read: SettingsReader, model: ImageModel, api: GeminiApi): GenerationOptions {
  const choice = (key: string) => {
    const value = effectiveValue(settingByKey(key, 'choice'), read, model, api);
    return value === UNSET ? undefined : value;
  };
  const num = (key: string) => {
    const setting = settingByKey(key, 'number');
    return parseNumber(effectiveValue(setting, read, model, api), setting);
  };
  const bool = (value: string | undefined, yes: string) => (value === undefined ? undefined : value === yes);

  const safetySettings: SafetySetting[] = [];
  for (const { category } of HARM_CATEGORIES) {
    const threshold = choice(safetyKey(category));
    if (threshold) safetySettings.push({ category, threshold });
  }
  const systemInstruction = effectiveValue(settingByKey('systemInstruction', 'text'), read, model, api);

  return {
    aspectRatio: choice('aspectRatio'),
    imageSize: choice('imageSize'),
    mimeType: choice('mimeType'),
    responseModalities: choice('responseModalities')?.split(','),
    thinkingLevel: choice('thinkingLevel'),
    includeThoughts: bool(choice('thoughts'), 'include'),
    temperature: num('temperature'),
    topP: num('topP'),
    topK: num('topK'),
    seed: num('seed'),
    safetySettings: safetySettings.length ? safetySettings : undefined,
    systemInstruction: systemInstruction || undefined,
    search: choice('search') as SearchMode | undefined,
    store: bool(choice('store'), 'true'),
    serviceTier: choice('serviceTier'),
  };
}
