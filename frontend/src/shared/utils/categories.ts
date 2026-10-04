/**
 * Pure helpers for lists of named items in user-ordered categories: the registered prompts
 * (docs/specs/prompt-manager.md) and characters (docs/specs/character-manager.md).
 * Category "" is 未分類: never listed in `categories`, always shown last. The backend checks the same rules.
 */

export const MAX_NAME_LENGTH = 100;
export const MAX_CATEGORY_LENGTH = 50;
export const UNCATEGORIZED_LABEL = '未分類';

/** A category filter: one category ("" = 未分類), or null for すべて. */
export type CategoryFilter = string | null;

export interface Categorized {
  id: string;
  name: string;
  category: string;
}

export interface CategorizedStore<T extends Categorized> {
  /** Category order (未分類 is not listed; it always comes last). */
  categories: string[];
  /** Items grouped by category in that order. */
  items: T[];
}

export interface CategoryGroup<T> {
  category: string;
  items: T[];
}

/** A category as stored: trimmed, "" for 未分類 (also when the label itself is typed). */
export function normalizeCategory(category: string): string {
  const trimmed = category.trim();
  return trimmed === UNCATEGORIZED_LABEL ? '' : trimmed;
}

export function categoryLabel(category: string): string {
  return category || UNCATEGORIZED_LABEL;
}

/** The message for a name / category that cannot be saved, or null. */
export function nameCategoryError(name: string, category: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '名前を入力してください。';
  if (trimmed.length > MAX_NAME_LENGTH) return `名前は ${MAX_NAME_LENGTH} 文字以内にしてください。`;
  if (normalizeCategory(category).length > MAX_CATEGORY_LENGTH) {
    return `カテゴリーは ${MAX_CATEGORY_LENGTH} 文字以内にしてください。`;
  }
  return null;
}

/** The item with `name` (compared trimmed), other than `exceptId`. */
export function findByName<T extends Categorized>(items: readonly T[], name: string, exceptId?: string): T | undefined {
  const trimmed = name.trim();
  return items.find(item => item.name === trimmed && item.id !== exceptId);
}

/** Search: the query (case-insensitive) in the name or the text. */
export function matchesQuery(item: { name: string; text: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || item.name.toLowerCase().includes(q) || item.text.toLowerCase().includes(q);
}

/** Every category in display order: the store's order, then 未分類 when an item has none. */
export function displayCategories(categories: readonly string[], items: readonly Categorized[]): string[] {
  const used = new Set(items.map(item => item.category));
  return [...categories.filter(c => used.has(c)), ...(used.has('') ? [''] : [])];
}

export function countByCategory(items: readonly Categorized[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return counts;
}

/** The items shown for a filter, grouped by category in display order (empty groups left out). */
export function groupByCategory<T extends Categorized>(
  categories: readonly string[],
  items: readonly T[],
  filter: CategoryFilter,
  matches: (item: T) => boolean,
): CategoryGroup<T>[] {
  const shown = filter === null ? displayCategories(categories, items) : [filter];
  return shown
    .map(category => ({ category, items: items.filter(item => item.category === category && matches(item)) }))
    .filter(group => group.items.length > 0);
}

/** Items can be dragged into a new order only within one category and without a search. */
export function isSortable(filter: CategoryFilter, query: string): boolean {
  return filter !== null && !query.trim();
}

/** The first `lines` non-blank lines of the text, with "…" when more follows. */
export function previewText(text: string, lines = 2): string {
  const all = text.split(/\r?\n/).filter(line => line.trim() !== '');
  const head = all.slice(0, lines).join('\n');
  return all.length > lines ? `${head}…` : head;
}
