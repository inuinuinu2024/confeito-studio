export interface SettingsData {
  [key: string]: string;
}

let settingsCache: SettingsData = {};
let isInitialized = false;

export async function initializeSettings(): Promise<void> {
  if (isInitialized) return;
  try {
    const res = await fetch('http://127.0.0.1:48000/api/settings/prompts');
    if (res.ok) {
      settingsCache = await res.json();
    }
  } catch (err) {
    console.error('Failed to load settings from backend', err);
  }
  isInitialized = true;
}

export function getGlobalSetting(key: string, defaultValue: string = ''): string {
  if (!isInitialized) {
    console.warn(`getGlobalSetting called for ${key} before initialization.`);
  }
  const val = settingsCache[key];
  return (val === undefined || val === null || val === '') ? defaultValue : val;
}

export async function setGlobalSetting(key: string, value: string): Promise<void> {
  settingsCache[key] = value;
  try {
    await fetch('http://127.0.0.1:48000/api/settings/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsCache),
    });
  } catch (err) {
    console.error('Failed to save settings to backend', err);
  }
}
