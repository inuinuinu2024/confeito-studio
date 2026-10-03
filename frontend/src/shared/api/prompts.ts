/** /api/prompts — the prompts the user registers, per tool (settings/prompts.json). `tool` is the tool's settingsPrefix. */
import { postJson, putJson, requestJson } from './http';

export interface SavedPrompt {
  id: string;
  name: string;
  text: string;
}

/** The tool's registered prompts in order, and warnings to show (a broken file). */
export async function listPrompts(tool: string): Promise<{ prompts: SavedPrompt[]; warnings: string[] }> {
  return requestJson(`/prompts/${encodeURIComponent(tool)}`);
}

/** Registers a prompt at the end of the list (the backend trims the name and rejects duplicates). */
export async function createPrompt(
  tool: string,
  name: string,
  text: string,
): Promise<{ prompt: SavedPrompt; warnings: string[] }> {
  return postJson(`/prompts/${encodeURIComponent(tool)}`, { name, text });
}

export async function updatePrompt(
  tool: string,
  id: string,
  name: string,
  text: string,
): Promise<{ prompt: SavedPrompt; warnings: string[] }> {
  return putJson(`/prompts/${encodeURIComponent(tool)}/${encodeURIComponent(id)}`, { name, text });
}

export async function deletePrompt(tool: string, id: string): Promise<{ warnings: string[] }> {
  return requestJson(`/prompts/${encodeURIComponent(tool)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
