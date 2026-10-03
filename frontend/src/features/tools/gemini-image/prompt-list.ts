/** Pure helpers for the registered prompts (prompt-library.ts). The backend checks the same rules. */
import type { SavedPrompt } from '../../../shared/api/prompts';

export const MAX_NAME_LENGTH = 100;

/** The message to show when the name or text cannot be registered, or null when they can. */
export function promptInputError(name: string, text: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '名前を入力してください。';
  if (trimmed.length > MAX_NAME_LENGTH) return `名前は ${MAX_NAME_LENGTH} 文字以内にしてください。`;
  if (!text.trim()) return 'プロンプトの本文を入力してください。';
  return null;
}

/** The registered prompt with `name` (compared trimmed), other than `exceptId`. */
export function findByName(prompts: readonly SavedPrompt[], name: string, exceptId?: string): SavedPrompt | undefined {
  const trimmed = name.trim();
  return prompts.find(p => p.name === trimmed && p.id !== exceptId);
}

/** The first `lines` non-blank lines of the text, with "…" when more follows. */
export function previewText(text: string, lines = 2): string {
  const all = text.split(/\r?\n/).filter(line => line.trim() !== '');
  const head = all.slice(0, lines).join('\n');
  return all.length > lines ? `${head}…` : head;
}
