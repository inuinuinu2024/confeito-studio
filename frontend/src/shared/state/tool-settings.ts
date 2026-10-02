/**
 * Persisted tool settings (backend settings/default_prompts.json, a flat string map).
 *
 * Loaded once at startup (`initializeSettings`); every write sends the whole map back.
 * Each tool uses its own key prefix through `toolSettings(prefix)`:
 *   const settings = toolSettings('panelSplitter');
 *   settings.get('model', 'gemini-3.8-flash');   // reads "panelSplitter_model"
 */
import { getToolSettings, saveToolSettings } from '../api/settings';

let cache: Record<string, string> = {};
let initialized = false;

export async function initializeSettings(): Promise<void> {
  if (initialized) return;
  try {
    cache = await getToolSettings();
  } catch (err) {
    console.error('[Settings] Failed to load settings from backend:', err);
  }
  initialized = true;
}

/** Stored value, or `defaultValue` when missing or empty. */
export function getGlobalSetting(key: string, defaultValue = ''): string {
  if (!initialized) console.warn(`getGlobalSetting called for ${key} before initialization.`);
  const value = cache[key];
  return value === undefined || value === null || value === '' ? defaultValue : value;
}

export async function setGlobalSetting(key: string, value: string): Promise<void> {
  cache[key] = value;
  try {
    await saveToolSettings(cache);
  } catch (err) {
    console.error('Failed to save settings to backend', err);
  }
}

export interface ToolSettings {
  get(key: string, defaultValue: string): string;
  set(key: string, value: string): void;
}

/** Settings accessor that namespaces keys as `${prefix}_${key}`. */
export function toolSettings(prefix: string): ToolSettings {
  return {
    get: (key, defaultValue) => getGlobalSetting(`${prefix}_${key}`, defaultValue),
    set: (key, value) => void setGlobalSetting(`${prefix}_${key}`, value),
  };
}
