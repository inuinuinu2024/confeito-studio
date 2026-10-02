/**
 * AI panel preferences in localStorage:
 *   aiPanelActiveTab  "all" | "custom"
 *   toolOrder         tool names in "All Tools" order
 *   customToolOrder   pinned tool names in "Custom" order
 */

export type PanelTab = 'all' | 'custom';

export const STORAGE_KEYS = {
  activeTab: 'aiPanelActiveTab',
  allOrder: 'toolOrder',
  customOrder: 'customToolOrder',
} as const;

export function loadActiveTab(): PanelTab {
  return (localStorage.getItem(STORAGE_KEYS.activeTab) as PanelTab) || 'all';
}

export function saveActiveTab(tab: PanelTab): void {
  localStorage.setItem(STORAGE_KEYS.activeTab, tab);
}

/** Saved name list, or null when absent or unreadable. */
export function loadNames(key: string): string[] | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as string[];
  } catch (err) {
    console.error(`Failed to parse ${key}`, err);
    return null;
  }
}

export function saveNames(key: string, names: string[]): void {
  localStorage.setItem(key, JSON.stringify(names));
}

/** Items sorted by their position in `order`; unknown items keep their relative order at the end. */
export function sortByOrder<T extends { name: string }>(items: readonly T[], order: string[] | null): T[] {
  const sorted = [...items];
  if (!order) return sorted;
  const rank = (name: string) => {
    const i = order.indexOf(name);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return sorted.sort((a, b) => rank(a.name) - rank(b.name));
}

/** Items whose names appear in `names`, in that order (unknown names are skipped). */
export function pickByNames<T extends { name: string }>(items: readonly T[], names: string[]): T[] {
  const byName = new Map(items.map(item => [item.name, item]));
  return names.flatMap(name => byName.get(name) ?? []);
}
