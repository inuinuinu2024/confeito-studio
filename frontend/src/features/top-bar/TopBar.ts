/**
 * TopBar — logo, menus (File / Edit / View / Help) and action icons.
 * Menu items without an action show a "開発中" toast.
 */
import './top-bar.css';
import { emit } from '../../shared/events';
import { h, icon } from '../../shared/ui/dom';
import { showToast } from '../../shared/ui/toast';
import { historyManager } from '../../shared/utils/history';
import { createBgColorDialog } from './components/BgColorDialog';
import { createSettingsDialog } from './components/SettingsDialog';
import { installShortcuts } from './shortcuts';

type MenuItem = { type: 'item'; label: string; shortcut?: string; action?: () => void } | { type: 'separator' };

interface MenuDef {
  label: string;
  items?: MenuItem[];
}

function buildMenu(items: MenuItem[]): HTMLDivElement {
  const dropdown = h('div', { class: 'topbar__dropdown' });
  for (const item of items) {
    if (item.type === 'separator') {
      dropdown.append(h('div', { class: 'topbar__dropdown-separator' }));
      continue;
    }
    dropdown.append(
      h(
        'a',
        {
          class: 'topbar__dropdown-item',
          onclick: (e: MouseEvent) => {
            e.preventDefault();
            if (item.action) item.action();
            else showToast(`${item.label} clicked`, 'mock');
          },
        },
        h('div', { class: 'topbar__dropdown-item-check' }),
        h('div', { class: 'topbar__dropdown-item-label', text: item.label }),
        item.shortcut ? h('div', { class: 'topbar__dropdown-item-shortcut', text: item.shortcut }) : null,
      ),
    );
  }
  return dropdown;
}

export function createTopBar(): HTMLElement {
  const settingsDialog = createSettingsDialog();
  const bgColorDialog = createBgColorDialog();
  installShortcuts({ openBgColorDialog: bgColorDialog.open });

  const menus: MenuDef[] = [
    {
      label: 'File',
      items: [
        { type: 'item', label: 'Save Image', shortcut: 'Ctrl+S', action: () => emit('file:save') },
        { type: 'item', label: 'Save Image As...', shortcut: 'Ctrl+Shift+S', action: () => emit('file:save-as') },
        { type: 'separator' },
        { type: 'item', label: 'Close Image', action: () => emit('file:close') },
      ],
    },
    {
      label: 'Edit',
      items: [
        { type: 'item', label: 'Undo', shortcut: 'Ctrl+Z', action: () => void historyManager.undo() },
        { type: 'item', label: 'Redo', shortcut: 'Ctrl+Y', action: () => void historyManager.redo() },
      ],
    },
    {
      label: 'View',
      items: [{ type: 'item', label: 'Background Color...', shortcut: 'Ctrl+B', action: bgColorDialog.open }],
    },
    { label: 'Help' },
  ];

  const nav = h(
    'nav',
    { class: 'topbar__nav' },
    ...menus.map(menu =>
      h(
        'div',
        { class: 'topbar__nav-item-wrapper' },
        h('a', {
          class: 'topbar__nav-item',
          text: menu.label,
          onclick: (e: MouseEvent) => {
            e.preventDefault();
            if (!menu.items) showToast(`${menu.label} メニュー`, 'mock');
          },
        }),
        menu.items ? buildMenu(menu.items) : null,
      ),
    ),
  );

  const actions: { iconName: string; label: string; action?: () => void }[] = [
    { iconName: 'settings', label: '設定', action: () => void settingsDialog.open() },
    { iconName: 'cloud_done', label: 'クラウド同期' },
    { iconName: 'account_circle', label: 'アカウント' },
  ];

  return h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'topbar__left' }, h('div', { class: 'topbar__logo', text: 'ConfeitO-StudiO' }), nav),
    h(
      'div',
      { class: 'topbar__right' },
      ...actions.map(a =>
        h(
          'button',
          {
            class: 'topbar__action-btn',
            title: a.label,
            onclick: () => (a.action ? a.action() : showToast(a.label, 'mock')),
          },
          icon(a.iconName),
        ),
      ),
    ),
  );
}
