import { showToast } from '../../../shared/utils/toast';

export function createSettingsDialog(): { overlay: HTMLElement; open: () => void; close: () => void } {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100vw';
  overlay.style.height = '100vh';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  overlay.style.display = 'none';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.zIndex = '9999';

  const dialog = document.createElement('div');
  dialog.className = 'settings-dialog';
  dialog.style.backgroundColor = 'var(--color-surface-container-highest)';
  dialog.style.padding = '24px';
  dialog.style.borderRadius = '8px';
  dialog.style.width = '400px';
  dialog.style.boxShadow = '0 8px 24px rgba(0,0,0,0.5)';
  dialog.style.display = 'flex';
  dialog.style.flexDirection = 'column';
  dialog.style.gap = '16px';
  dialog.style.border = '1px solid var(--color-outline-variant)';

  const title = document.createElement('h2');
  title.textContent = 'Settings';
  title.style.margin = '0';
  title.style.fontSize = '18px';
  title.style.color = 'var(--color-on-surface)';
  dialog.appendChild(title);

  const fieldGroup = document.createElement('div');
  fieldGroup.style.display = 'flex';
  fieldGroup.style.flexDirection = 'column';
  fieldGroup.style.gap = '8px';

  const label = document.createElement('label');
  label.textContent = 'Gemini API Key';
  label.style.fontSize = '14px';
  label.style.color = 'var(--color-on-surface-variant)';
  fieldGroup.appendChild(label);

  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = 'AIzaSy...';
  input.style.padding = '8px';
  input.style.borderRadius = '4px';
  input.style.border = '1px solid var(--color-outline)';
  input.style.backgroundColor = 'var(--color-surface-container-lowest)';
  input.style.color = 'var(--color-on-surface)';
  input.style.width = '100%';
  fieldGroup.appendChild(input);

  dialog.appendChild(fieldGroup);

  const buttonGroup = document.createElement('div');
  buttonGroup.style.display = 'flex';
  buttonGroup.style.justifyContent = 'flex-end';
  buttonGroup.style.gap = '8px';
  buttonGroup.style.marginTop = '8px';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.padding = '8px 16px';
  cancelBtn.style.borderRadius = '4px';
  cancelBtn.style.border = '1px solid var(--color-outline)';
  cancelBtn.style.backgroundColor = 'transparent';
  cancelBtn.style.color = 'var(--color-on-surface)';
  cancelBtn.style.cursor = 'pointer';
  buttonGroup.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.padding = '8px 16px';
  saveBtn.style.borderRadius = '4px';
  saveBtn.style.border = 'none';
  saveBtn.style.backgroundColor = 'var(--color-primary)';
  saveBtn.style.color = 'var(--color-on-primary)';
  saveBtn.style.cursor = 'pointer';
  buttonGroup.appendChild(saveBtn);

  dialog.appendChild(buttonGroup);
  overlay.appendChild(dialog);

  const open = () => {
    input.value = localStorage.getItem('geminiApiKey') || '';
    overlay.style.display = 'flex';
  };

  const close = () => {
    overlay.style.display = 'none';
  };

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  saveBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (val) {
      localStorage.setItem('geminiApiKey', val);
    } else {
      localStorage.removeItem('geminiApiKey');
    }
    showToast('Settings saved', 'success');
    close();
  });

  return { overlay, open, close };
}
