/**
 * Toast notification — Displays a brief "not yet implemented" message.
 */

let activeToast: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show a toast indicating a feature is not yet implemented.
 * @param featureName  Human-readable name of the feature
 */
export function showToast(message: string, isMock: boolean = false): void {
  // Remove any existing toast immediately
  if (activeToast) {
    activeToast.remove();
    activeToast = null;
  }
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  const toast = document.createElement('div');
  toast.className = 'toast';

  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined toast__icon';
  icon.textContent = 'info';
  toast.appendChild(icon);

  const text = document.createElement('span');
  text.textContent = isMock ? `「${message}」は現在開発中です` : message;
  toast.appendChild(text);

  document.body.appendChild(toast);
  activeToast = toast;

  // Trigger enter animation on next frame
  requestAnimationFrame(() => {
    toast.classList.add('toast--visible');
  });

  // Auto-hide after 2 seconds
  hideTimer = setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => {
      toast.remove();
      if (activeToast === toast) activeToast = null;
    });
  }, 2000);
}
