/**
 * Tool list order, kept in the settings file (settings/default_prompts.json, key
 * "aiPanel_toolOrder" = JSON array of tool names) — nothing is stored in the browser.
 */
import { toolSettings } from '../../shared/state/tool-settings';

const settings = toolSettings('aiPanel');
const KEY = 'toolOrder';

/** Saved tool order, or null when absent or unreadable. */
export function loadToolOrder(): string[] | null {
  const raw = settings.get(KEY, '');
  if (!raw) return null;
  try {
    const names: unknown = JSON.parse(raw);
    return Array.isArray(names) ? names.map(String) : null;
  } catch (err) {
    console.error('Failed to parse aiPanel_toolOrder', err);
    return null;
  }
}

export function saveToolOrder(names: string[]): void {
  settings.set(KEY, JSON.stringify(names));
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
