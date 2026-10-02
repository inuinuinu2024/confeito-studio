/** /api/nano-banana-pro — multimodal image generation through Gemini (backend/src/app/routers/generate.py). */
import { request } from './http';

export type GenerationInput = { type: 'image'; mime_type: string; data: string } | { type: 'text'; text: string };

/** Interactions API payload. The backend forwards only the fields declared here (other top-level fields are dropped). */
export interface InteractionsPayload {
  model: string;
  input: GenerationInput[];
  response_format: { type: 'image'; mime_type?: string; aspect_ratio?: string; image_size?: string };
  generation_config?: Record<string, unknown>;
  system_instruction?: string;
  tools?: Record<string, unknown>[];
  store?: boolean;
  service_tier?: string;
}

export type GenerateContentPart = { inlineData: { mimeType: string; data: string } } | { text: string };

/** generateContent request body plus `model`, which the backend moves into the URL. */
export interface GenerateContentPayload {
  model: string;
  contents: { role: 'user'; parts: GenerateContentPart[] }[];
  systemInstruction?: { parts: { text: string }[] };
  generationConfig?: Record<string, unknown>;
  safetySettings?: { category: string; threshold: string }[];
  tools?: Record<string, unknown>[];
  serviceTier?: string;
  store?: boolean;
}

const HEADERS = { 'X-Provider': 'gemini' };

async function postForImage(path: string, payload: unknown): Promise<Blob> {
  const res = await request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...HEADERS },
    body: JSON.stringify(payload),
  });
  return res.blob();
}

/** Interactions API. Returns the generated image (Blob.type = the image's MIME type). */
export function generateImage(payload: InteractionsPayload): Promise<Blob> {
  return postForImage('/nano-banana-pro', payload);
}

/** generateContent API. Returns the generated image (Blob.type = the image's MIME type). */
export function generateImageWithGenerateContent(payload: GenerateContentPayload): Promise<Blob> {
  return postForImage('/nano-banana-pro/generate-content', payload);
}
