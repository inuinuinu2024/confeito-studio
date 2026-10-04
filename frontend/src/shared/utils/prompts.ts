/**
 * Pure helpers for the registered prompts (docs/specs/prompt-manager.md), used by the Prompt Manager
 * and the tools' prompt field. The category rules are shared with the characters (categories.ts);
 * the backend checks the same input rules.
 */
import type { PromptStore, SavedPrompt } from '../api/prompts';
import {
  type CategoryFilter,
  displayCategories as categoriesInUse,
  countByCategory as countItems,
  groupByCategory,
  MAX_NAME_LENGTH,
  matchesQuery,
  nameCategoryError,
} from './categories';

export {
  type CategoryFilter,
  categoryLabel,
  findByName,
  isSortable,
  MAX_CATEGORY_LENGTH,
  MAX_NAME_LENGTH,
  matchesQuery,
  normalizeCategory,
  previewText,
  UNCATEGORIZED_LABEL,
} from './categories';

export interface PromptGroup {
  category: string;
  prompts: SavedPrompt[];
}

/** The message to show when the input cannot be saved, or null when it can. */
export function promptInputError(name: string, category: string, text: string): string | null {
  const error = nameCategoryError(name, category);
  if (error) return error;
  if (!text.trim()) return 'プロンプトの本文を入力してください。';
  return null;
}

/** Every category in display order: the store's order, then 未分類 when a prompt has none. */
export function displayCategories(store: PromptStore): string[] {
  return categoriesInUse(store.categories, store.prompts);
}

export function countByCategory(store: PromptStore): Map<string, number> {
  return countItems(store.prompts);
}

/** The prompts shown for a filter and a query, grouped by category in display order (empty groups left out). */
export function groupPrompts(store: PromptStore, filter: CategoryFilter, query: string): PromptGroup[] {
  return groupByCategory(store.categories, store.prompts, filter, p => matchesQuery(p, query)).map(g => ({
    category: g.category,
    prompts: g.items,
  }));
}

// ── Export / import ──

export const EXPORT_FORMAT = 'confeito-prompts';

export function exportData(store: PromptStore): object {
  return {
    format: EXPORT_FORMAT,
    version: 1,
    categories: store.categories,
    prompts: store.prompts.map(({ name, category, text }) => ({ name, category, text })),
  };
}

export interface ImportFile {
  prompts: unknown[];
  categories: unknown[];
}

/** The prompts in an exported file (or prompts.json); throws an Error with a Japanese message. */
export function parseImportFile(text: string): ImportFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON として読めないファイルです。');
  }
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  if (!record || !Array.isArray(record.prompts)) throw new Error('プロンプトの一覧（prompts）がないファイルです。');
  return { prompts: record.prompts, categories: Array.isArray(record.categories) ? record.categories : [] };
}

/** How many valid items would hit a name that is registered or appears earlier in the file. */
export function countImportConflicts(prompts: readonly SavedPrompt[], items: readonly unknown[]): number {
  const names = new Set(prompts.map(p => p.name));
  let conflicts = 0;
  for (const item of items) {
    const entry = item as { name?: unknown; text?: unknown } | null;
    if (!entry || typeof entry.name !== 'string' || typeof entry.text !== 'string') continue;
    const name = entry.name.trim();
    if (!name || name.length > MAX_NAME_LENGTH || !entry.text.trim()) continue;
    if (names.has(name)) conflicts++;
    names.add(name);
  }
  return conflicts;
}
