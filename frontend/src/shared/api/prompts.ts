/**
 * /api/prompts — the prompts the user registers, shared by every tool (assets/prompts/prompts.json;
 * docs/specs/prompt-manager.md). Category "" is 未分類.
 */
import { postJson, putJson, requestJson } from './http';

export interface SavedPrompt {
  id: string;
  name: string;
  category: string;
  text: string;
}

export interface PromptStore {
  /** Category order (未分類 is not listed; it always comes last). */
  categories: string[];
  /** Prompts grouped by category in that order. */
  prompts: SavedPrompt[];
}

type Warned<T = object> = T & { warnings: string[] };

export type ImportConflictPolicy = 'overwrite' | 'rename' | 'skip';

export interface ImportCounts {
  added: number;
  overwritten: number;
  skipped: number;
  invalid: number;
}

const enc = encodeURIComponent;

/** Every prompt, and warnings to show (a broken file). */
export async function listPrompts(): Promise<Warned<PromptStore>> {
  return requestJson('/prompts');
}

/** Registers a prompt at the end of its category (the backend trims and rejects duplicate names). */
export async function createPrompt(
  name: string,
  category: string,
  text: string,
): Promise<Warned<{ prompt: SavedPrompt }>> {
  return postJson('/prompts', { name, category, text });
}

/** Replaces a prompt; it keeps its place unless the category changes (then it goes to the end). */
export async function updatePrompt(
  id: string,
  name: string,
  category: string,
  text: string,
): Promise<Warned<{ prompt: SavedPrompt }>> {
  return putJson(`/prompts/${enc(id)}`, { name, category, text });
}

export async function deletePrompt(id: string): Promise<Warned> {
  return requestJson(`/prompts/${enc(id)}`, { method: 'DELETE' });
}

/** Copies a prompt as "<name> のコピー" right after it. */
export async function duplicatePrompt(id: string): Promise<Warned<{ prompt: SavedPrompt }>> {
  return postJson(`/prompts/${enc(id)}/duplicate`, {});
}

/** Moves a prompt to the end of `category`. */
export async function movePrompt(id: string, category: string): Promise<Warned<{ prompt: SavedPrompt }>> {
  return putJson(`/prompts/${enc(id)}/category`, { category });
}

/** The order of one category's prompts (409 when the list changed meanwhile). */
export async function reorderPrompts(category: string, ids: string[]): Promise<Warned> {
  return putJson('/prompts/order', { category, ids });
}

export async function reorderCategories(categories: string[]): Promise<Warned> {
  return putJson('/prompts/categories/order', { categories });
}

/** Renames a category; into an existing one (or "" = 未分類) its prompts are merged at the end. */
export async function renameCategory(oldName: string, newName: string): Promise<Warned> {
  return postJson('/prompts/categories/rename', { old: oldName, new: newName });
}

export async function importPrompts(
  prompts: unknown[],
  categories: unknown[],
  onConflict: ImportConflictPolicy,
): Promise<Warned<ImportCounts>> {
  return postJson('/prompts/import', { prompts, categories, on_conflict: onConflict });
}
