/**
 * Prompt textarea with a "default prompt" editor (pencil icon).
 * Settings keys: `<prefix>_prompt` (current text, saved when the tool runs) and `<prefix>_defaultPrompt`
 * (saved as soon as the editor's 保存 is pressed, with the prompt when it follows the new default).
 */
import type { ToolSettings } from '../../../shared/state/tool-settings';
import { openTextEditDialog } from '../../../shared/ui/dialogs';
import { h } from '../../../shared/ui/dom';
import { iconButton } from '../../../shared/ui/form';

export function promptField(label: string, settings: ToolSettings, fallbackDefault: string): HTMLElement {
  const defaultPrompt = settings.get('defaultPrompt', fallbackDefault);
  const textarea = h('textarea', {
    class: 'cs-textarea',
    value: settings.get('prompt', defaultPrompt),
    placeholder: defaultPrompt,
  });
  textarea.addEventListener('input', () => settings.set('prompt', textarea.value));

  const editDefault = () =>
    openTextEditDialog({
      title: 'デフォルトプロンプト',
      value: settings.get('defaultPrompt', fallbackDefault),
      onSave: value => {
        settings.set('defaultPrompt', value);
        const saved = ['defaultPrompt'];
        // A prompt that matches the stored one follows the new default.
        if (textarea.value === settings.get('prompt', '')) {
          textarea.value = value;
          settings.set('prompt', value);
          saved.push('prompt');
        }
        textarea.placeholder = value;
        void settings.save(saved);
      },
    });

  return h(
    'div',
    { class: 'cs-field' },
    h(
      'div',
      { class: 'cs-field__label-row cs-field__label-row--spread' },
      h('label', { class: 'cs-field__label', text: label }),
      iconButton('edit', 'デフォルトプロンプトを編集', editDefault),
    ),
    textarea,
  );
}
