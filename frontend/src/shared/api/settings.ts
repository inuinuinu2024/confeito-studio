/** /api/settings — Gemini API key and persisted tool settings (settings/default_prompts.json). */
import { postJson, requestJson } from './http';

export async function getGeminiKeyStatus(): Promise<{ has_key: boolean }> {
  return requestJson('/settings/gemini');
}

/** Saves the key to the project .env (and the running backend's environment). */
export async function saveGeminiKey(apiKey: string): Promise<void> {
  await postJson('/settings/gemini', { api_key: apiKey });
}

export async function getToolSettings(): Promise<Record<string, string>> {
  return requestJson('/settings/prompts');
}

/** Replaces the whole settings map. */
export async function saveToolSettings(values: Record<string, string>): Promise<void> {
  await postJson('/settings/prompts', values);
}
