export interface SettingsData {
  [key: string]: string;
}

let settingsCache: SettingsData = {};
let isInitialized = false;

export async function initializeSettings(retries = 10, delayMs = 1000): Promise<void> {
  if (isInitialized) return;
  
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch('http://127.0.0.1:48000/api/settings/prompts');
      if (res.ok) {
        settingsCache = await res.json();
        isInitialized = true;
        return;
      }
    } catch (err) {
      console.warn(`[Settings] Failed to load settings from backend (attempt ${i + 1}/${retries}). Retrying in ${delayMs}ms...`);
    }
    // Wait before retrying
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  
  console.error('[Settings] Failed to load settings from backend after multiple attempts. Using fallback defaults.');
  isInitialized = true; // Mark as initialized to prevent infinite stalls
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
