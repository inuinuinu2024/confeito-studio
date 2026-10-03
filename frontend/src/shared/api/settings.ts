/** /api/settings — Gemini API key and the tool settings (settings/default_prompts.json + user_settings.json). */
import { postJson, requestJson } from './http';

export async function getGeminiKeyStatus(): Promise<{ has_key: boolean }> {
  return requestJson('/settings/gemini');
}

/** Saves the key to the project .env (and the running backend's environment). */
export async function saveGeminiKey(apiKey: string): Promise<void> {
  await postJson('/settings/gemini', { api_key: apiKey });
}

/** Tool settings: the initial values with the user's values on top, and warnings to show (broken files). */
export async function getToolSettings(): Promise<{ values: Record<string, string>; warnings: string[] }> {
  return requestJson('/settings/tools');
}

/** Merges `values` into the user's settings (other keys are kept); resolves with warnings to show. */
export async function updateToolSettings(values: Record<string, string>): Promise<{ warnings: string[] }> {
  return postJson('/settings/tools', { values });
}
