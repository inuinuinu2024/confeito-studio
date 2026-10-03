/**
 * SettingsWindow (gear icon, Ctrl+B) — modal window with the setting pages listed on the left and
 * the chosen page on the right (docs/specs/app-shell.md 「設定ウィンドウ」):
 *   API  — Gemini API key, written to the project .env with the page's 保存 button.
 *   表示 — canvas background colour, applied and saved as soon as a swatch is clicked.
 * While it is open the app behind it is dimmed and inert; ×, Esc and a click on the backdrop close it.
 */
import { getGeminiKeyStatus, saveGeminiKey } from '../../../shared/api/settings';
import { emit } from '../../../shared/events';
import { BG_COLORS, loadBgColor, saveBgColor } from '../../../shared/state/canvas-background';
import { h, icon } from '../../../shared/ui/dom';
import { button } from '../../../shared/ui/form';
import { showError, showToast } from '../../../shared/ui/toast';

export type SettingsPage = 'api' | 'display';

export interface SettingsWindow {
  /** Opens the window on `page` (the first page when omitted); switches pages when already open. */
  open(page?: SettingsPage): void;
  close(): void;
}

const FADE_MS = 150;

/** Another dialog above the window gets Esc first. */
const hasDialogAbove = () => !!document.querySelector('dialog[open], .cs-modal-overlay--open');

function section(title: string, description: string, ...content: HTMLElement[]): HTMLElement {
  return h(
    'section',
    { class: 'settings-window__section' },
    h('h3', { class: 'settings-window__section-title', text: title }),
    h('p', { class: 'settings-window__section-desc', text: description }),
    ...content,
  );
}

function createApiPage(): { element: HTMLElement; refresh: () => Promise<void> } {
  const input = h('input', { class: 'cs-input', type: 'password', placeholder: 'AIzaSy...' });
  const status = h('p', { class: 'settings-window__status' });
  const saveButton = button('保存', () => void save(), { variant: 'primary', size: 'dialog' });

  const refresh = async () => {
    input.value = '';
    saveButton.disabled = true;
    status.textContent = '';
    try {
      const { has_key } = await getGeminiKeyStatus();
      status.textContent = has_key ? '保存済み（.env）' : '未設定';
    } catch (err) {
      console.error(err);
      status.textContent = '状態を取得できませんでした';
    }
  };

  const save = async () => {
    const value = input.value.trim();
    if (!value) return;
    saveButton.disabled = true;
    try {
      await saveGeminiKey(value);
      showToast('Gemini API Key を .env に保存しました', 'success');
      emit('settings:updated');
      await refresh();
    } catch (err) {
      console.error(err);
      showError('設定を保存できませんでした', err);
      saveButton.disabled = false;
    }
  };

  input.addEventListener('input', () => (saveButton.disabled = !input.value.trim()));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') void save();
  });

  const element = h(
    'div',
    { class: 'settings-window__page' },
    h('h2', { class: 'settings-window__page-title', text: 'API' }),
    section(
      'Gemini API Key',
      'Gemini を使うツール（コマ分割・Nano Banana画像生成）で使います。プロジェクトの .env に保存します。',
      h('div', { class: 'settings-window__row' }, input, saveButton),
      status,
    ),
  );
  return { element, refresh };
}

function createDisplayPage(): { element: HTMLElement; refresh: () => void } {
  const current = h('p', { class: 'settings-window__status' });
  const swatches = BG_COLORS.map(color =>
    h('button', {
      class: color.value === 'checkerboard' ? 'bg-swatch bg-swatch--checkerboard' : 'bg-swatch',
      title: color.label,
      style: color.value === 'checkerboard' ? undefined : { backgroundColor: color.value },
      onclick: () => {
        saveBgColor(color.value);
        markSelected(color.value);
        showToast(`背景色を「${color.name}」に変更しました`, 'success');
      },
    }),
  );
  const markSelected = (value: string) => {
    swatches.forEach((swatch, i) => swatch.classList.toggle('bg-swatch--selected', BG_COLORS[i].value === value));
    current.textContent = `選択中: ${BG_COLORS.find(color => color.value === value)?.name ?? ''}`;
  };

  const element = h(
    'div',
    { class: 'settings-window__page' },
    h('h2', { class: 'settings-window__page-title', text: '表示' }),
    section(
      'キャンバスの背景色',
      '画像の周囲（透明部分）を塗る色です。選ぶとすぐ反映し、次回の起動でも使います。',
      h('div', { class: 'bg-swatches' }, ...swatches),
      current,
    ),
  );
  return { element, refresh: () => markSelected(loadBgColor()) };
}

export function createSettingsWindow(): SettingsWindow {
  const apiPage = createApiPage();
  const displayPage = createDisplayPage();
  const pages: { id: SettingsPage; label: string; icon: string; element: HTMLElement }[] = [
    { id: 'api', label: 'API', icon: 'key', element: apiPage.element },
    { id: 'display', label: '表示', icon: 'palette', element: displayPage.element },
  ];

  const navItems = pages.map(page =>
    h(
      'button',
      { class: 'settings-window__nav-item', onclick: () => showPage(page.id) },
      icon(page.icon, 18),
      h('span', { text: page.label }),
    ),
  );
  const main = h('div', { class: 'settings-window__main' });
  const closeButton = h('button', { class: 'settings-window__close', title: '閉じる' }, icon('close', 20));
  const panel = h(
    'div',
    { class: 'settings-window', tabIndex: -1, attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': '設定' } },
    h(
      'nav',
      { class: 'settings-window__nav' },
      h('div', { class: 'settings-window__nav-title', text: '設定' }),
      ...navItems,
    ),
    main,
    closeButton,
  );
  const overlay = h('div', { class: 'settings-window-overlay' }, panel);

  let isOpen = false;
  let returnFocus: HTMLElement | null = null;
  let pressedOnBackdrop = false;

  function showPage(id: SettingsPage): void {
    const index = pages.findIndex(page => page.id === id);
    navItems.forEach((item, i) => item.classList.toggle('settings-window__nav-item--active', i === index));
    main.replaceChildren(pages[index].element);
    main.scrollTop = 0;
  }

  closeButton.addEventListener('click', () => close());
  // Close on a click that starts and ends on the backdrop.
  overlay.addEventListener('pointerdown', e => (pressedOnBackdrop = e.target === overlay));
  overlay.addEventListener('click', e => {
    if (pressedOnBackdrop && e.target === overlay) close();
    pressedOnBackdrop = false;
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || hasDialogAbove()) return;
    e.preventDefault();
    close();
  };

  /** The app behind the window: dimmed by the backdrop and made inert (no focus, no clicks). */
  const setAppInert = (inert: boolean) => {
    const app = document.getElementById('app');
    if (app) app.inert = inert;
  };

  function open(page: SettingsPage = 'api'): void {
    showPage(page);
    if (isOpen) return;
    isOpen = true;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void apiPage.refresh();
    displayPage.refresh();

    overlay.classList.remove('settings-window-overlay--open');
    document.body.appendChild(overlay);
    void overlay.offsetHeight; // reflow so the fade-in transition runs
    overlay.classList.add('settings-window-overlay--open');
    setAppInert(true);
    document.addEventListener('keydown', onKeyDown);
    panel.focus();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener('keydown', onKeyDown);
    setAppInert(false);
    overlay.classList.remove('settings-window-overlay--open');
    setTimeout(() => {
      if (!isOpen) overlay.remove();
    }, FADE_MS);
    returnFocus?.focus();
  }

  return { open, close };
}
