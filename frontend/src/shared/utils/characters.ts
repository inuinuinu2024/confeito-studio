/**
 * Pure helpers for the registered characters (docs/specs/character-manager.md), used by the Character
 * Manager and the tools' character picker. The category rules are shared with the prompts (categories.ts).
 */
import type { CharacterStore, SavedCharacter } from '../api/characters';
import { type CategoryFilter, type CategoryGroup, groupByCategory, matchesQuery } from './categories';

/** Image types a character can have (the backend checks the content). */
export const CHARACTER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export function isCharacterImage(file: File): boolean {
  return CHARACTER_IMAGE_TYPES.includes(file.type);
}

/** An image of the character in the Character Manager's editor: a saved file of the character, or a new file. */
export type EditorImage = { saved: string } | { file: File };

/** Same images in the same order (new files compared by identity). */
export function sameImages(a: readonly EditorImage[], b: readonly EditorImage[]): boolean {
  return (
    a.length === b.length &&
    a.every((image, i) => {
      const other = b[i];
      if ('saved' in image) return 'saved' in other && other.saved === image.saved;
      return 'file' in other && other.file === image.file;
    })
  );
}

/** The icon in the editor: the saved file, a new image from the icon cropper, or none. */
export type EditorIcon = { saved: string } | { blob: Blob } | null;

/** Same icon (new images compared by identity). */
export function sameIcon(a: EditorIcon, b: EditorIcon): boolean {
  if (a === null || b === null) return a === b;
  if ('saved' in a) return 'saved' in b && a.saved === b.saved;
  return 'blob' in b && a.blob === b.blob;
}

/** The characters shown for a filter and a query (name or text), grouped by category in display order. */
export function groupCharacters(
  store: CharacterStore,
  filter: CategoryFilter,
  query: string,
): CategoryGroup<SavedCharacter>[] {
  return groupByCategory(store.categories, store.characters, filter, c => matchesQuery(c, query));
}

/**
 * Descriptions of a character's reference images in a tool: every image is labelled with the name,
 * the first one also carries the text (docs/specs/tools/gemini-image.md 「登録したキャラクター」).
 */
export function referenceDescriptions(name: string, text: string, count: number): string[] {
  const label = `キャラクター「${name}」`;
  return Array.from({ length: count }, (_, i) => (i === 0 && text.trim() ? `${label}\n${text.trim()}` : label));
}

/** The prompt with the text appended after a blank line (just the text when the prompt is empty). */
export function appendToPrompt(prompt: string, text: string): string {
  const trimmed = prompt.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${text.trim()}` : text.trim();
}
