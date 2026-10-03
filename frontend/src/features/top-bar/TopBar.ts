/**
 * TopBar — logo and action icons (settings / cloud sync / account; the last two show a "開発中" toast).
 * There are no menus: undo is the button next to delete in ARCHIVES, the background colour is in the
 * settings window.
 */
import './top-bar.css';
import { h, icon } from '../../shared/ui/dom';
import { showToast } from '../../shared/ui/toast';
import { createSettingsWindow } from './components/SettingsWindow';
import { installShortcuts } from './shortcuts';

export function createTopBar(): HTMLElement {
  const settingsWindow = createSettingsWindow();
  installShortcuts({ openDisplaySettings: () => settingsWindow.open('display') });

  const actions: { iconName: string; label: string; action?: () => void }[] = [
    { iconName: 'settings', label: '設定', action: () => settingsWindow.open() },
    { iconName: 'cloud_done', label: 'クラウド同期' },
    { iconName: 'account_circle', label: 'アカウント' },
  ];

  return h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'topbar__logo', text: 'ConfeitO Studio' }),
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
