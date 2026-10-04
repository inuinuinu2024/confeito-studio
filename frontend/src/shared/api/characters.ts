/**
 * /api/characters — the characters the user registers, shared by every tool (assets/characters/;
 * docs/specs/character-manager.md). Category "" is 未分類. `images` are the file names of a character's
 * images in order; `characterImageUrl` / `fetchCharacterImage` read one. `icon` is a 256x256 PNG shown in
 * the lists (never one of the images); `detectFaces` finds anime faces to place its crop frame.
 */
import { API_BASE } from '../config';
import { postForm, postJson, putJson, request, requestJson } from './http';

export interface SavedCharacter {
  id: string;
  name: string;
  category: string;
  text: string;
  images: string[];
  /** The prompt text of each image (only images with a text): `{file name: text}`. */
  image_texts: Record<string, string>;
  /** File name of the icon, or null. */
  icon: string | null;
}

export interface CharacterStore {
  /** Category order (未分類 is not listed; it always comes last). */
  categories: string[];
  /** Characters grouped by category in that order. */
  characters: SavedCharacter[];
}

/** One image of a character being saved: a saved file of that character, or a new file to upload; with its text. */
export type CharacterImageInput = ({ file: string } | { blob: Blob; name: string }) & { text: string };

export interface CharacterFields {
  name: string;
  category: string;
  text: string;
  images: CharacterImageInput[];
  /** Keep the saved icon, remove it, or a new icon image. */
  icon: 'keep' | 'none' | Blob;
}

/** An anime face found in an image, in its pixels. */
export interface DetectedFace {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

type Warned<T = object> = T & { warnings: string[] };

export type ImportConflictPolicy = 'overwrite' | 'rename' | 'skip';

export interface ImportPreview {
  count: number;
  conflicts: number;
  invalid: number;
}

export interface ImportCounts {
  added: number;
  overwritten: number;
  skipped: number;
  invalid: number;
  skipped_images: number;
}

const enc = encodeURIComponent;

/** Every character, and warnings to show (a broken file). */
export async function listCharacters(): Promise<Warned<CharacterStore>> {
  return requestJson('/characters');
}

/** The multipart body: `data` (JSON; images refer to saved files or to the n-th upload) + `files`. */
function characterForm(fields: CharacterFields): FormData {
  const form = new FormData();
  let uploads = 0;
  const images = fields.images.map(image => {
    if ('file' in image) return { file: image.file, text: image.text };
    form.append('files', image.blob, image.name);
    return { upload: uploads++, text: image.text };
  });
  let icon: 'keep' | 'none' | 'upload';
  if (fields.icon instanceof Blob) {
    form.append('icon', fields.icon, 'icon.png');
    icon = 'upload';
  } else icon = fields.icon;
  form.append(
    'data',
    JSON.stringify({ name: fields.name, category: fields.category, text: fields.text, images, icon }),
  );
  return form;
}

/** Registers a character at the end of its category (the backend trims and rejects duplicate names). */
export async function createCharacter(fields: CharacterFields): Promise<Warned<{ character: SavedCharacter }>> {
  return postForm('/characters', characterForm(fields));
}

/** Replaces a character; saved images left out of `images` are deleted. */
export async function updateCharacter(
  id: string,
  fields: CharacterFields,
): Promise<Warned<{ character: SavedCharacter }>> {
  return requestJson(`/characters/${enc(id)}`, { method: 'PUT', body: characterForm(fields) });
}

/** Deletes a character with its images. */
export async function deleteCharacter(id: string): Promise<Warned> {
  return requestJson(`/characters/${enc(id)}`, { method: 'DELETE' });
}

/** Copies a character (and its images) as "<name> のコピー" right after it. */
export async function duplicateCharacter(id: string): Promise<Warned<{ character: SavedCharacter }>> {
  return postJson(`/characters/${enc(id)}/duplicate`, {});
}

/** Moves a character to the end of `category`. */
export async function moveCharacter(id: string, category: string): Promise<Warned<{ character: SavedCharacter }>> {
  return putJson(`/characters/${enc(id)}/category`, { category });
}

/** The order of one category's characters (409 when the list changed meanwhile). */
export async function reorderCharacters(category: string, ids: string[]): Promise<Warned> {
  return putJson('/characters/order', { category, ids });
}

export async function reorderCharacterCategories(categories: string[]): Promise<Warned> {
  return putJson('/characters/categories/order', { categories });
}

/** Renames a category; into an existing one (or "" = 未分類) its characters are merged at the end. */
export async function renameCharacterCategory(oldName: string, newName: string): Promise<Warned> {
  return postJson('/characters/categories/rename', { old: oldName, new: newName });
}

/** URL of one of a character's images (for <img>; the backend answers with no-store). */
export function characterImageUrl(id: string, file: string): string {
  return `${API_BASE}/characters/${enc(id)}/images/${enc(file)}`;
}

/** URL of a character's icon; `file` (the icon's name) makes the URL change with the icon. */
export function characterIconUrl(id: string, file: string): string {
  return `${API_BASE}/characters/${enc(id)}/icon?v=${enc(file)}`;
}

/** Anime faces in an image, highest score first (the backend downloads its model on first use). */
export async function detectFaces(image: Blob, signal?: AbortSignal): Promise<Warned<{ faces: DetectedFace[] }>> {
  const form = new FormData();
  form.append('image', image, 'image');
  return requestJson('/characters/detect-faces', { method: 'POST', body: form, signal });
}

export async function fetchCharacterImage(id: string, file: string): Promise<Blob> {
  return (await request(`/characters/${enc(id)}/images/${enc(file)}`)).blob();
}

/** Every character with its images as a zip. */
export async function exportCharacters(): Promise<Blob> {
  return (await request('/characters/export')).blob();
}

/** What importing the zip would do (nothing is written). */
export async function previewCharacterImport(file: Blob): Promise<Warned<ImportPreview>> {
  const form = new FormData();
  form.append('file', file);
  return postForm('/characters/import/preview', form);
}

export async function importCharacters(file: Blob, onConflict: ImportConflictPolicy): Promise<Warned<ImportCounts>> {
  const form = new FormData();
  form.append('file', file);
  form.append('on_conflict', onConflict);
  return postForm('/characters/import', form);
}
