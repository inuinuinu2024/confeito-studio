/** Toast notification at the bottom of the screen (one at a time). */

export type ToastType = 'info' | 'success' | 'error' | 'mock';

const ICONS: Record<ToastType, string> = { info: 'info', mock: 'info', success: 'check_circle', error: 'error' };

let activeToast: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Shows `message` (errors stay 6s, others 2s).
 * `mock` displays "「message」は現在開発中です" for features that are not implemented yet.
 */
export function showToast(message: string, type: ToastType = 'info'): void {
  activeToast?.remove();
  activeToast = null;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'error') toast.classList.add('toast--error');
  if (type === 'success') toast.classList.add('toast--success');

  const iconEl = document.createElement('span');
  iconEl.className = 'material-symbols-outlined toast__icon';
  iconEl.textContent = ICONS[type];
  const text = document.createElement('span');
  text.textContent = type === 'mock' ? `「${message}」は現在開発中です` : message;
  toast.append(iconEl, text);

  document.body.appendChild(toast);
  activeToast = toast;
  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  hideTimer = setTimeout(
    () => {
      toast.classList.remove('toast--visible');
      toast.addEventListener('transitionend', () => {
        toast.remove();
        if (activeToast === toast) activeToast = null;
      });
    },
    type === 'error' ? 6000 : 2000,
  );
}
