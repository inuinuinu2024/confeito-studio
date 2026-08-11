/**
 * Toast notification — Displays a brief "not yet implemented" message.
 */

let activeToast: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show a toast indicating a feature is not yet implemented.
 * @param featureName  Human-readable name of the feature
 */
export type ToastType = 'info' | 'success' | 'error' | 'mock' | boolean;

export function showToast(message: string, type: ToastType = 'info'): void {
  const resolvedType = type === true ? 'mock' : (type === false ? 'info' : type);
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
  
  if (resolvedType === 'error') {
    icon.textContent = 'error';
    toast.classList.add('toast--error');
  } else if (resolvedType === 'success') {
    icon.textContent = 'check_circle';
    toast.classList.add('toast--success');
  } else {
    icon.textContent = 'info';
  }
  
  toast.appendChild(icon);

  const text = document.createElement('span');
  text.textContent = resolvedType === 'mock' ? `「${message}」は現在開発中です` : message;
  toast.appendChild(text);

  document.body.appendChild(toast);
  activeToast = toast;

  // Trigger enter animation on next frame
  requestAnimationFrame(() => {
    toast.classList.add('toast--visible');
  });

  // Auto-hide after specified duration
  const duration = resolvedType === 'error' ? 6000 : 2000;
  hideTimer = setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => {
      toast.remove();
      if (activeToast === toast) activeToast = null;
    });
  }, duration);
}
