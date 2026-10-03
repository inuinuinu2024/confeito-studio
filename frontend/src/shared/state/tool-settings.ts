/**
 * Tool settings (docs/specs/app-shell.md 「設定の保存」): the initial values
 * (settings/default_settings.json, in git) with the user's values (settings/user_settings.json) on top.
 * Registered prompts are kept apart (shared/api/prompts.ts).
 *
 * - Read when the app starts and every time a tool window opens (`loadSettings`); changes that were
 *   not saved yet are dropped then.
 * - `set` only changes the value in memory. The changed keys of a tool are written when the tool
 *   runs (`saveSettings(prefix)`, called by the tool runner), or right away with `ToolSettings.save`
 *   for explicit saves (tool order). Only the changed keys are sent; the backend
 *   merges them into the user's settings.
 *
 * Each tool uses its own key prefix through `toolSettings(prefix)`:
 *   const settings = toolSettings('panelSplitter');
 *   settings.get('model', 'gemini-3.8-flash');   // reads "panelSplitter_model"
 */
import { getToolSettings, updateToolSettings } from '../api/settings';
import { showError, showToast } from '../ui/toast';

let cache: Record<string, string> = {};
/** Keys changed in memory since they were last loaded or saved. */
const pending = new Set<string>();
let loaded = false;

/** (Re)reads the settings from the backend, dropping unsaved changes. Shows warnings / errors as toasts. */
export async function loadSettings(): Promise<void> {
  try {
    const { values, warnings } = await getToolSettings();
    cache = { ...values };
    pending.clear();
    for (const warning of warnings) showToast(warning, 'warning');
  } catch (err) {
    showError('ツールの設定を読み込めませんでした', err);
  }
  loaded = true;
}

/** Stored value, or `defaultValue` when missing or empty. */
export function getGlobalSetting(key: string, defaultValue = ''): string {
  if (!loaded) console.warn(`getGlobalSetting called for ${key} before the settings were loaded.`);
  const value = cache[key];
  return value === undefined || value === null || value === '' ? defaultValue : value;
}

/** Changes the value in memory; it is written by the next `saveSettings` that covers the key. */
export function setGlobalSetting(key: string, value: string): void {
  cache[key] = value;
  pending.add(key);
}

/**
 * Writes the unsaved keys under `prefix` (`<prefix>_...`), only `keys` when given. Resolves false
 * (after an error toast) when the backend could not save them; they stay unsaved.
 */
export async function saveSettings(prefix: string, keys?: readonly string[]): Promise<boolean> {
  const targets = [...pending].filter(key => key.startsWith(`${prefix}_`) && (!keys || keys.includes(key)));
  if (targets.length === 0) return true;
  const values = Object.fromEntries(targets.map(key => [key, cache[key]]));
  try {
    const { warnings } = await updateToolSettings(values);
    // A key changed again while saving stays unsaved.
    for (const key of targets) if (cache[key] === values[key]) pending.delete(key);
    for (const warning of warnings) showToast(warning, 'warning');
    return true;
  } catch (err) {
    showError('ツールの設定を保存できませんでした', err);
    return false;
  }
}

export interface ToolSettings {
  get(key: string, defaultValue: string): string;
  /** Changes the value in memory (written when the tool runs). */
  set(key: string, value: string): void;
  /** Writes the unsaved values of this prefix now (only `keys` when given). */
  save(keys?: readonly string[]): Promise<boolean>;
}

/** Settings accessor that namespaces keys as `${prefix}_${key}`. */
export function toolSettings(prefix: string): ToolSettings {
  return {
    get: (key, defaultValue) => getGlobalSetting(`${prefix}_${key}`, defaultValue),
    set: (key, value) => setGlobalSetting(`${prefix}_${key}`, value),
    save: keys =>
      saveSettings(
        prefix,
        keys?.map(key => `${prefix}_${key}`),
      ),
  };
}
