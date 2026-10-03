/**
 * Pure helpers for the registered prompts (docs/specs/prompt-manager.md), used by the Prompt Manager
 * and the tools' prompt field. The backend checks the same input rules.
 */
import type { PromptStore, SavedPrompt } from '../api/prompts';

export const MAX_NAME_LENGTH = 100;
export const MAX_CATEGORY_LENGTH = 50;
export const UNCATEGORIZED_LABEL = '未分類';

/** A category filter: one category ("" = 未分類), or null for すべて. */
export type CategoryFilter = string | null;

export interface PromptGroup {
  category: string;
  prompts: SavedPrompt[];
}

/** A category as stored: trimmed, "" for 未分類 (also when the label itself is typed). */
export function normalizeCategory(category: string): string {
  const trimmed = category.trim();
  return trimmed === UNCATEGORIZED_LABEL ? '' : trimmed;
}

export function categoryLabel(category: string): string {
  return category || UNCATEGORIZED_LABEL;
}

/** The message to show when the input cannot be saved, or null when it can. */
export function promptInputError(name: string, category: string, text: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '名前を入力してください。';
  if (trimmed.length > MAX_NAME_LENGTH) return `名前は ${MAX_NAME_LENGTH} 文字以内にしてください。`;
  if (normalizeCategory(category).length > MAX_CATEGORY_LENGTH) {
    return `カテゴリーは ${MAX_CATEGORY_LENGTH} 文字以内にしてください。`;
  }
  if (!text.trim()) return 'プロンプトの本文を入力してください。';
  return null;
}

/** The registered prompt with `name` (compared trimmed), other than `exceptId`. */
export function findByName(prompts: readonly SavedPrompt[], name: string, exceptId?: string): SavedPrompt | undefined {
  const trimmed = name.trim();
  return prompts.find(p => p.name === trimmed && p.id !== exceptId);
}

/** The first `lines` non-blank lines of the text, with "…" when more follows. */
export function previewText(text: string, lines = 2): string {
  const all = text.split(/\r?\n/).filter(line => line.trim() !== '');
  const head = all.slice(0, lines).join('\n');
  return all.length > lines ? `${head}…` : head;
}

/** Search: the query (case-insensitive) in the name or the text. */
export function matchesQuery(prompt: SavedPrompt, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || prompt.name.toLowerCase().includes(q) || prompt.text.toLowerCase().includes(q);
}

/** Every category in display order: the store's order, then 未分類 when a prompt has none. */
export function displayCategories(store: PromptStore): string[] {
  const used = new Set(store.prompts.map(p => p.category));
  return [...store.categories.filter(c => used.has(c)), ...(used.has('') ? [''] : [])];
}

export function countByCategory(store: PromptStore): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of store.prompts) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return counts;
}

/** The prompts shown for a filter and a query, grouped by category in display order (empty groups left out). */
export function groupPrompts(store: PromptStore, filter: CategoryFilter, query: string): PromptGroup[] {
  const categories = filter === null ? displayCategories(store) : [filter];
  return categories
    .map(category => ({
      category,
      prompts: store.prompts.filter(p => p.category === category && matchesQuery(p, query)),
    }))
    .filter(group => group.prompts.length > 0);
}

/** Prompts can be dragged into a new order only within one category and without a search. */
export function isSortable(filter: CategoryFilter, query: string): boolean {
  return filter !== null && !query.trim();
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
