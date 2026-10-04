/** /api/settings — Gemini API key, the ARCHIVES folder (保存先) and the tool settings (settings/default_settings.json + user_settings.json). */
import { postJson, requestJson } from './http';

export async function getGeminiKeyStatus(): Promise<{ has_key: boolean }> {
  return requestJson('/settings/gemini');
}

/** Saves the key to the project .env (and the running backend's environment). */
export async function saveGeminiKey(apiKey: string): Promise<void> {
  await postJson('/settings/gemini', { api_key: apiKey });
}

/** Tool settings: the initial values with the user's values on top, and warnings to show (broken files). */
export async function getToolSettings(): Promise<{ values: Record<string, string>; warnings: string[] }> {
  return requestJson('/settings/tools');
}

/** Merges `values` into the user's settings (other keys are kept); resolves with warnings to show. */
export async function updateToolSettings(values: Record<string, string>): Promise<{ warnings: string[] }> {
  return postJson('/settings/tools', { values });
}

/** The ARCHIVES folder (docs/specs/archives.md 「保存先」). */
export interface ArchivesLocation {
  /** Full path of the folder in use. */
  path: string;
  /** The default folder (<project>/archives). */
  default_path: string;
  is_default: boolean;
  exists: boolean;
  /** Why the saved folder was not used at startup, or null. */
  ignored: string | null;
}

export interface ArchivesLocationChange extends ArchivesLocation {
  /** The folder does not exist and was not created: nothing changed (ask, then send `create`). */
  missing: boolean;
  changed: boolean;
  /** The folder asked for, as the backend resolved it. */
  requested_path: string;
}

export async function getArchivesLocation(): Promise<ArchivesLocation> {
  return requestJson('/settings/archives');
}

/** Switches the ARCHIVES folder to `path` ("" = the default); nothing is moved. ApiError 400 for refused folders. */
export async function setArchivesLocation(path: string, create = false): Promise<ArchivesLocationChange> {
  return postJson('/settings/archives', { path, create });
}
