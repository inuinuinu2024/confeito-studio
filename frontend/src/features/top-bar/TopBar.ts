/**
 * TopBar — Application header with logo, menu navigation,
 * and action buttons.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';
import { createSettingsDialog } from './components/SettingsDialog';
import { createBgColorDialog } from './components/BgColorDialog';
import { getRecentFiles, clearRecentFiles } from '../../shared/utils/idb';
import { historyManager } from '../../shared/utils/history';

type MenuItemDef = 
  | { type: 'item'; label: string; checked?: boolean; shortcut?: string; action?: () => void }
  | { type: 'separator' }
  | { type: 'submenu'; label: string; items: MenuItemDef[] };

const fileMenuItems: MenuItemDef[] = [
  { type: 'item', label: 'Open PSD', shortcut: 'Ctrl+O', action: () => window.dispatchEvent(new Event('file:open')) },
  { type: 'submenu', label: 'Open Recent', items: [
    { type: 'item', label: 'Loading...' }
  ] },
  { type: 'item', label: 'Save', shortcut: 'Ctrl+S', action: () => window.dispatchEvent(new Event('file:save')) },
  { type: 'item', label: 'Save As...', shortcut: 'Ctrl+Shift+S', action: () => window.dispatchEvent(new Event('file:save-as')) },
];

// We will attach the action to this menu item later when we have the dialog instance
let openBgColorDialog = () => {};

const editMenuItems: MenuItemDef[] = [
  { type: 'item', label: 'Undo', shortcut: 'Ctrl+Z', action: () => historyManager.undo() },
  { type: 'item', label: 'Redo', shortcut: 'Ctrl+Y', action: () => historyManager.redo() }
];

window.addEventListener('keydown', (e) => {
  // Prevent undo/redo if typing in an input field
  const target = e.target as HTMLElement;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    return;
  }
  
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') {
      e.preventDefault();
      historyManager.undo();
    } else if (e.key === 'y') {
      e.preventDefault();
      historyManager.redo();
    } else if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      window.dispatchEvent(new Event('file:open'));
    } else if (e.key === 's') {
      e.preventDefault();
      window.dispatchEvent(new Event('file:save'));
    } else if (e.key === 'S') {
      e.preventDefault();
      window.dispatchEvent(new Event('file:save-as'));
    } else if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      openBgColorDialog();
    }
  }
});

const viewMenuItems: MenuItemDef[] = [
  {
    type: 'item',
    label: 'Background Color...',
    shortcut: 'Ctrl+B',
    action: () => openBgColorDialog()
  }
];

const topMenuDefs: { label: string; items?: MenuItemDef[] }[] = [
  { label: 'File', items: fileMenuItems },
  { label: 'Edit', items: editMenuItems },
  { label: 'View', items: viewMenuItems },
  { label: 'Help' },
];

async function updateRecentFilesMenu(submenu: HTMLElement) {
  try {
    const recents = await getRecentFiles();
    const items: MenuItemDef[] = recents.map(r => ({
      type: 'item',
      label: r.filename,
      action: () => window.dispatchEvent(new CustomEvent('file:open-recent', { 
        detail: { handle: r.fileHandle, filename: r.filename } 
      }))
    }));

    if (items.length > 0) {
      items.push({ type: 'separator' });
    }
    
    items.push({
      type: 'item',
      label: 'Clear Recent...',
      action: async () => {
        await clearRecentFiles();
      }
    });

    const newDOM = buildMenuDOM(items);
    submenu.innerHTML = '';
    while (newDOM.firstChild) {
      submenu.appendChild(newDOM.firstChild);
    }
  } catch (err) {
    console.error('Failed to update recent files menu', err);
  }
}

function buildMenuDOM(items: MenuItemDef[]): HTMLElement {
  const container = document.createElement('div');
  
  for (const item of items) {
    if (item.type === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'topbar__dropdown-separator';
      container.appendChild(sep);
      continue;
    }

    const a = document.createElement('a');
    a.className = 'topbar__dropdown-item';
    
    // Checkmark
    const check = document.createElement('div');
    check.className = 'topbar__dropdown-item-check';
    if (item.type === 'item' && item.checked) {
      check.appendChild(icon('check', 14));
    }
    a.appendChild(check);

    // Label
    const label = document.createElement('div');
    label.className = 'topbar__dropdown-item-label';
    label.textContent = item.label;
    a.appendChild(label);

    if (item.type === 'item') {
      if (item.shortcut) {
        const shortcut = document.createElement('div');
        shortcut.className = 'topbar__dropdown-item-shortcut';
        shortcut.textContent = item.shortcut;
        a.appendChild(shortcut);
      }
      
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (item.action) {
           item.action();
        } else {
           showToast(`${item.label} clicked`, true);
        }
      });
    } else if (item.type === 'submenu') {
      const chevron = document.createElement('div');
      chevron.className = 'topbar__dropdown-item-chevron';
      chevron.appendChild(icon('chevron_right', 16));
      a.appendChild(chevron);
      
      a.addEventListener('click', (e) => e.preventDefault());

      const submenu = buildMenuDOM(item.items);
      submenu.className = 'topbar__submenu';
      a.appendChild(submenu);
      a.classList.add('topbar__submenu-wrapper');

      if (item.label === 'Open Recent') {
        // Initial populate
        updateRecentFilesMenu(submenu);
        // Re-populate on updates
        window.addEventListener('recent-files:updated', () => {
          updateRecentFilesMenu(submenu);
        });
      }
    }
    
    container.appendChild(a);
  }
  
  return container;
}

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
  for (const menuDef of topMenuDefs) {
    const wrapper = document.createElement('div');
    wrapper.className = 'topbar__nav-item-wrapper';

    const a = document.createElement('a');
    a.className = 'topbar__nav-item';
    a.textContent = menuDef.label;

    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (!menuDef.items) {
        showToast(`${menuDef.label} メニュー`, true);
      }
    });

    wrapper.appendChild(a);

    if (menuDef.items) {
      const dropdown = buildMenuDOM(menuDef.items);
      dropdown.className = 'topbar__dropdown';
      wrapper.appendChild(dropdown);
    }
    
    nav.appendChild(wrapper);
  }
  left.appendChild(nav);
  header.appendChild(left);

  // ── Right side: Status + Action buttons ──
  const right = document.createElement('div');
  right.className = 'topbar__right';

  // Action icons
  const actionButtons: { iconName: string; label: string; action?: () => void }[] = [
    { iconName: 'settings', label: '設定', action: () => settingsDialog.open() },
    { iconName: 'cloud_done', label: 'クラウド同期' },
    { iconName: 'account_circle', label: 'アカウント' },
  ];
  
  const settingsDialog = createSettingsDialog();
  document.body.appendChild(settingsDialog.overlay);

  const bgColorDialog = createBgColorDialog();
  document.body.appendChild(bgColorDialog.overlay);
  openBgColorDialog = () => bgColorDialog.open();

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
