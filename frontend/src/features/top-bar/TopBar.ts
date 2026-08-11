/**
 * TopBar — Application header with logo, menu navigation,
 * ComfyUI connection status, and action buttons.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';
import { createSettingsDialog } from './components/SettingsDialog';

const menuItems = [
  { label: 'File' },
  { label: 'Edit' },
  { label: 'View' },
  { label: 'Layer' },
  { label: 'Window' },
  { label: 'Help' },
];

export function createTopBar(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'topbar';

  // ── Left side: Logo + Navigation ──
  const left = document.createElement('div');
  left.className = 'topbar__left';

  const logo = document.createElement('div');
  logo.className = 'topbar__logo';
  logo.textContent = 'Confeito-Studio';
  left.appendChild(logo);

  const nav = document.createElement('nav');
  nav.className = 'topbar__nav';
  for (const item of menuItems) {
    if (item.label === 'File') {
      const wrapper = document.createElement('div');
      wrapper.className = 'topbar__nav-item-wrapper';

      const a = document.createElement('a');
      a.className = 'topbar__nav-item';
      a.href = '#';
      a.textContent = item.label;

      const dropdown = document.createElement('div');
      dropdown.className = 'topbar__dropdown';

      const openOption = document.createElement('a');
      openOption.className = 'topbar__dropdown-item';
      openOption.href = '#';
      openOption.textContent = 'Open PSD';
      openOption.addEventListener('click', (e) => {
        e.preventDefault();
        window.dispatchEvent(new Event('file:open'));
      });
      dropdown.appendChild(openOption);

      const saveOption = document.createElement('a');
      saveOption.className = 'topbar__dropdown-item';
      saveOption.href = '#';
      saveOption.textContent = 'Save';
      saveOption.addEventListener('click', (e) => {
        e.preventDefault();
        window.dispatchEvent(new Event('file:save'));
      });
      dropdown.appendChild(saveOption);

      const saveAsOption = document.createElement('a');
      saveAsOption.className = 'topbar__dropdown-item';
      saveAsOption.href = '#';
      saveAsOption.textContent = 'Save As...';
      saveAsOption.addEventListener('click', (e) => {
        e.preventDefault();
        window.dispatchEvent(new Event('file:save-as'));
      });
      dropdown.appendChild(saveAsOption);

      a.addEventListener('click', (e) => {
        e.preventDefault();
      });

      wrapper.appendChild(a);
      wrapper.appendChild(dropdown);
      nav.appendChild(wrapper);
    } else {
      const a = document.createElement('a');
      a.className = 'topbar__nav-item';
      a.href = '#';
      a.textContent = item.label;

      a.addEventListener('click', (e) => {
        e.preventDefault();
        showToast(`${item.label} メニュー`, true);
      });

      nav.appendChild(a);
    }
  }
  left.appendChild(nav);
  header.appendChild(left);

  // ── Right side: Status + Action buttons ──
  const right = document.createElement('div');
  right.className = 'topbar__right';

  // ComfyUI status badge
  const status = document.createElement('div');
  status.className = 'topbar__status';
  const dot = document.createElement('span');
  dot.className = 'topbar__status-dot';
  status.appendChild(dot);
  status.appendChild(document.createTextNode('ComfyUI: Connected'));
  right.appendChild(status);

  // Action icons
  const actionButtons: { iconName: string; label: string; action?: () => void }[] = [
    { iconName: 'settings', label: '設定', action: () => settingsDialog.open() },
    { iconName: 'cloud_done', label: 'クラウド同期' },
    { iconName: 'account_circle', label: 'アカウント' },
  ];
  
  const settingsDialog = createSettingsDialog();
  document.body.appendChild(settingsDialog.overlay);

  for (const action of actionButtons) {
    const btn = document.createElement('button');
    btn.className = 'topbar__action-btn';
    btn.appendChild(icon(action.iconName));
    btn.addEventListener('click', () => {
      if (action.action) {
        action.action();
      } else {
        showToast(action.label, true);
      }
    });
    right.appendChild(btn);
  }

  header.appendChild(right);

  return header;
}
