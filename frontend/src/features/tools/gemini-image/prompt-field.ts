/**
 * Prompt textarea with a "default prompt" editor (pencil icon).
 * Settings keys: `<prefix>_prompt` (current text) and `<prefix>_defaultPrompt`.
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
        // A prompt that matches the stored one follows the new default.
        if (textarea.value === settings.get('prompt', '')) {
          textarea.value = value;
          settings.set('prompt', value);
        }
        textarea.placeholder = value;
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
