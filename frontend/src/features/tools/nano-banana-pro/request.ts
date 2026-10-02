/**
 * Builds the Nano Banana Pro request for the selected API (pure, unit tested).
 *
 * Options that are undefined are left out of the request entirely ("既定（送らない）").
 * Spec: docs/specs/tools/nano-banana-pro.md
 */
import type {
  GenerateContentPart,
  GenerateContentPayload,
  GenerationInput,
  InteractionsPayload,
} from '../../../shared/api/generation';
import type { SearchMode } from './models';

export interface SafetySetting {
  category: string;
  threshold: string;
}

/** API-independent generation options (resolved from the settings by options.ts). */
export interface GenerationOptions {
  aspectRatio?: string;
  imageSize?: string;
  /** 'image/png' | 'image/jpeg' */
  mimeType?: string;
  /** generateContent only. */
  responseModalities?: string[];
  /** 'minimal' | 'high' (lowercase; upper-cased for generateContent). */
  thinkingLevel?: string;
  includeThoughts?: boolean;
  /** generateContent only. */
  temperature?: number;
  /** generateContent only. */
  topP?: number;
  /** generateContent only. */
  topK?: number;
  seed?: number;
  /** generateContent only. */
  safetySettings?: SafetySetting[];
  systemInstruction?: string;
  search?: SearchMode;
  store?: boolean;
  serviceTier?: string;
}

/** Copy without undefined values, or undefined when nothing is left. */
function compact<T extends Record<string, unknown>>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

export function interactionsRequest(
  model: string,
  input: GenerationInput[],
  options: GenerationOptions,
): InteractionsPayload {
  const o = options;
  const tools =
    o.search === 'web'
      ? [{ type: 'google_search' }]
      : o.search === 'web+image'
        ? [{ type: 'google_search', search_types: ['web_search', 'image_search'] }]
        : undefined;
  const payload: InteractionsPayload = {
    model,
    input,
    response_format: {
      type: 'image',
      ...compact({ mime_type: o.mimeType, aspect_ratio: o.aspectRatio, image_size: o.imageSize }),
    },
  };
  return Object.assign(
    payload,
    compact({
      generation_config: compact({
        thinking_level: o.thinkingLevel,
        thinking_summaries: o.includeThoughts === undefined ? undefined : o.includeThoughts ? 'auto' : 'none',
        seed: o.seed,
      }),
      system_instruction: o.systemInstruction,
      tools,
      store: o.store,
      service_tier: o.serviceTier,
    }),
  );
}

export function generateContentRequest(
  model: string,
  input: GenerationInput[],
  options: GenerationOptions,
): GenerateContentPayload {
  const o = options;
  const parts: GenerateContentPart[] = input.map(part =>
    part.type === 'image' ? { inlineData: { mimeType: part.mime_type, data: part.data } } : { text: part.text },
  );
  const tools =
    o.search === 'web'
      ? [{ googleSearch: {} }]
      : o.search === 'web+image'
        ? [{ googleSearch: { searchTypes: { webSearch: {}, imageSearch: {} } } }]
        : undefined;
  const payload: GenerateContentPayload = { model, contents: [{ role: 'user', parts }] };
  return Object.assign(
    payload,
    compact({
      systemInstruction: o.systemInstruction === undefined ? undefined : { parts: [{ text: o.systemInstruction }] },
      generationConfig: compact({
        responseModalities: o.responseModalities,
        temperature: o.temperature,
        topP: o.topP,
        topK: o.topK,
        seed: o.seed,
        thinkingConfig: compact({ thinkingLevel: o.thinkingLevel?.toUpperCase(), includeThoughts: o.includeThoughts }),
        imageConfig: compact({ aspectRatio: o.aspectRatio, imageSize: o.imageSize }),
        responseFormat: o.mimeType === 'image/jpeg' ? { image: { mimeType: 'IMAGE_JPEG' } } : undefined,
      }),
      safetySettings: o.safetySettings?.length ? o.safetySettings : undefined,
      tools,
      serviceTier: o.serviceTier,
      store: o.store,
    }),
  );
}

/** Copy of either payload with base64 image data replaced (JSON preview, saved payload.json). */
export function redactImageData<T extends InteractionsPayload | GenerateContentPayload>(
  payload: T,
  placeholder: string,
): T {
  const copy = structuredClone(payload);
  for (const part of (copy as Partial<InteractionsPayload>).input ?? []) {
    if (part.type === 'image') part.data = placeholder;
  }
  for (const content of (copy as Partial<GenerateContentPayload>).contents ?? []) {
    for (const part of content.parts) if ('inlineData' in part) part.inlineData.data = placeholder;
  }
  return copy;
}
