/** Settings dialog (gear icon): stores the Gemini API key in the project .env. */
import { getGeminiKeyStatus, saveGeminiKey } from '../../../shared/api/settings';
import { emit } from '../../../shared/events';
import { createModal } from '../../../shared/ui/dialogs';
import { h } from '../../../shared/ui/dom';
import { button, field } from '../../../shared/ui/form';
import { showError, showToast } from '../../../shared/ui/toast';

export function createSettingsDialog(): { open: () => Promise<void> } {
  const modal = createModal({ title: 'Settings', overlayClass: 'settings-overlay' });
  const input = h('input', { class: 'cs-input', type: 'password', placeholder: 'AIzaSy...' });

  const save = async () => {
    const value = input.value.trim();
    if (value) {
      try {
        await saveGeminiKey(value);
        showToast('Gemini API Key を .env に保存しました', 'success');
      } catch (err) {
        console.error(err);
        showError('設定を保存できませんでした', err);
      }
    }
    emit('settings:updated');
    modal.close();
  };

  modal.panel.append(
    field('Gemini API Key', input),
    h(
      'div',
      { class: 'cs-modal__actions' },
      button('Cancel', () => modal.close(), { variant: 'outline', size: 'dialog' }),
      button('Save', () => void save(), { variant: 'primary', size: 'dialog' }),
    ),
  );

  return {
    async open() {
      input.value = '';
      try {
        const { has_key } = await getGeminiKeyStatus();
        input.placeholder = has_key ? '******** (Saved in .env)' : 'Enter Gemini API Key';
      } catch (err) {
        console.error(err);
        input.placeholder = 'Failed to fetch status';
      }
      modal.open();
    },
  };
}
