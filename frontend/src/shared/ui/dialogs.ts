/** Modal dialogs (styles: shared/styles/components.css). Windows are shared/ui/window.ts. */
import { h } from './dom';
import { button, type ButtonVariant } from './form';
import { showToast } from './toast';
import { escapeClosable, openWindow } from './window';

export { escapeClosable };

export interface Modal {
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
  open(): void;
  close(): void;
}

/**
 * Overlay + centered panel. The overlay is appended to <body> once and toggled by
 * open()/close(). By default clicking outside the panel closes it.
 */
export function createModal(opts: {
  title: string;
  width?: string;
  overlayClass?: string;
  closeOnBackdrop?: boolean;
}): Modal {
  const panel = h(
    'div',
    { class: 'cs-modal', style: opts.width ? { width: opts.width } : undefined },
    h('h2', { class: 'cs-modal__title', text: opts.title }),
  );
  const overlay = h('div', { class: `cs-modal-overlay ${opts.overlayClass ?? ''}`.trim() }, panel);
  const modal: Modal = {
    overlay,
    panel,
    open: () => overlay.classList.add('cs-modal-overlay--open'),
    close: () => overlay.classList.remove('cs-modal-overlay--open'),
  };
  if (opts.closeOnBackdrop !== false) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) modal.close();
    });
  }
  document.body.appendChild(overlay);
  return modal;
}

/** Shows `data` as pretty-printed JSON in a window (shared/ui/window.ts) with a コピー button in its header. */
export function openJsonPreview(data: unknown, title = 'JSON Preview'): void {
  const json = JSON.stringify(data, null, 2);
  const copy = button(
    'コピー',
    () => {
      void navigator.clipboard.writeText(json);
      showToast('JSONをクリップボードにコピーしました');
    },
    { variant: 'outline', size: 'small' },
  );
  const win = openWindow({ title, className: 'cs-json-window', headerTools: [copy] });
  win.body.append(h('pre', { class: 'cs-json-window__json', text: json }));
}
export interface DialogChoice<T extends string> {
  value: T;
  label: string;
  variant?: ButtonVariant;
}

/**
 * A question with several answers in a modal: resolves the chosen value, or null for キャンセル and Esc.
 * The buttons are キャンセル then the choices; the last choice has the focus.
 */
export function choiceDialog<T extends string>(opts: {
  title: string;
  message: string;
  choices: DialogChoice<T>[];
}): Promise<T | null> {
  return new Promise(resolve => {
    const modal = createModal({ title: opts.title, closeOnBackdrop: false });
    const remove = escapeClosable(modal.overlay, () => answer(null));
    const answer = (value: T | null) => {
      remove();
      resolve(value);
    };
    const buttons = opts.choices.map(c =>
      button(c.label, () => answer(c.value), { variant: c.variant ?? 'default', size: 'dialog' }),
    );
    modal.panel.append(
      h('p', { class: 'cs-modal__message', text: opts.message }),
      h(
        'div',
        { class: 'cs-modal__actions' },
        button('キャンセル', () => answer(null), { variant: 'outline', size: 'dialog' }),
        ...buttons,
      ),
    );
    modal.open();
    buttons[buttons.length - 1]?.focus();
  });
}

/** Yes / no question in a modal; resolves true for `confirmLabel`, false for キャンセル and Esc. */
export async function confirmDialog(opts: { title: string; message: string; confirmLabel: string }): Promise<boolean> {
  const choice = await choiceDialog({
    title: opts.title,
    message: opts.message,
    choices: [{ value: 'ok', label: opts.confirmLabel, variant: 'primary' }],
  });
  return choice === 'ok';
}
