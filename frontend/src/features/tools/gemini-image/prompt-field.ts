/**
 * Prompt textarea with buttons to register its text and to read a registered prompt (prompt-library.ts).
 * The text is the setting `<prefix>_prompt` (saved with the other settings when the tool runs);
 * registered prompts are kept apart and shared by every tool (docs/specs/prompt-manager.md).
 * `append` adds a text at the end (a registered character without images; docs/specs/tools/gemini-image.md).
 */
import type { ToolSettings } from '../../../shared/state/tool-settings';
import { h } from '../../../shared/ui/dom';
import { iconButton } from '../../../shared/ui/form';
import { appendToPrompt } from '../../../shared/utils/characters';
import { openPromptPicker, openRegisterDialog } from './prompt-library';

export interface PromptField {
  el: HTMLElement;
  append(text: string): void;
}

export function promptField(label: string, settings: ToolSettings): PromptField {
  const textarea = h('textarea', {
    class: 'cs-textarea',
    value: settings.get('prompt', ''),
    placeholder: 'プロンプトを入力（登録したプロンプトは右上のボタンから読み出せます）',
  });
  textarea.addEventListener('input', () => settings.set('prompt', textarea.value));
  const usePrompt = (text: string) => {
    textarea.value = text;
    settings.set('prompt', text);
  };

  const el = h(
    'div',
    { class: 'cs-field' },
    h(
      'div',
      { class: 'cs-field__label-row cs-field__label-row--spread' },
      h('label', { class: 'cs-field__label', text: label }),
      h(
        'div',
        { class: 'prompt-field__actions' },
        iconButton('bookmark_add', 'このプロンプトを登録', () => openRegisterDialog(textarea.value)),
        iconButton('library_books', '登録したプロンプトを開く', () => openPromptPicker(usePrompt)),
      ),
    ),
    textarea,
  );
  return { el, append: text => usePrompt(appendToPrompt(textarea.value, text)) };
}
