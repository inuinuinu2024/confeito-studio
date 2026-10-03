/**
 * Toasts stacked at the bottom of the screen (rules: docs/specs/notifications.md).
 * `showToast` toasts hide after 4s; `showError` toasts stay until closed with ×.
 */
import { describeError } from '../utils/error-message';
import { h, icon } from './dom';

export type ToastType = 'info' | 'success' | 'warning' | 'mock';

const ICONS: Record<ToastType | 'error', string> = {
  info: 'info',
  mock: 'info',
  success: 'check_circle',
  warning: 'warning',
  error: 'error',
};
const AUTO_HIDE_MS = 4000;
const FADE_MS = 200;

let stack: HTMLElement | null = null;

function toastIcon(type: ToastType | 'error'): HTMLElement {
  const el = icon(ICONS[type]);
  el.classList.add('toast__icon');
  return el;
}

function dismiss(toast: HTMLElement): void {
  toast.classList.remove('toast--visible');
  setTimeout(() => toast.remove(), FADE_MS);
}

function mount(toast: HTMLElement): void {
  if (!stack?.isConnected) {
    stack = h('div', { class: 'toast-stack' });
    document.body.appendChild(stack);
  }
  stack.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
}

/**
 * Shows `message` for 4s. `mock` displays "「message」は現在開発中です" for features that are
 * not implemented yet. Use `showError` for failures.
 */
export function showToast(message: string, type: ToastType = 'info'): void {
  const toast = h(
    'div',
    { class: `toast toast--${type}` },
    toastIcon(type),
    h('span', { class: 'toast__message', text: type === 'mock' ? `「${message}」は現在開発中です` : message }),
  );
  mount(toast);
  setTimeout(() => dismiss(toast), AUTO_HIDE_MS);
}

/**
 * Error toast that stays until closed: `title`, the Japanese message for `err` and, when there
 * is one, the original system text (scrollable, copyable).
 */
export function showError(title: string, err?: unknown): void {
  const { message, detail } = err === undefined ? { message: '', detail: undefined } : describeError(err);
  const close = h('button', { class: 'toast__close', title: '閉じる' }, icon('close', 16));
  const copy = h('button', { class: 'toast__copy', text: 'コピー' });
  const toast = h(
    'div',
    { class: 'toast toast--error', attrs: { role: 'alert' } },
    h(
      'div',
      { class: 'toast__row' },
      toastIcon('error'),
      h(
        'div',
        { class: 'toast__body' },
        h('div', { class: 'toast__title', text: title }),
        message ? h('div', { class: 'toast__message', text: message }) : null,
      ),
      close,
    ),
    detail ? h('pre', { class: 'toast__detail', text: detail }) : null,
    h('div', { class: 'toast__actions' }, copy),
  );

  close.addEventListener('click', () => dismiss(toast));
  copy.addEventListener('click', () => {
    const text = [title, message, detail].filter(Boolean).join('\n\n');
    navigator.clipboard.writeText(text).then(
      () => showToast('エラーの内容をコピーしました'),
      () => showToast('クリップボードにコピーできませんでした', 'warning'),
    );
  });
  mount(toast);
}
