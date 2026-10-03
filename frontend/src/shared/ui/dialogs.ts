/** Modal dialogs (styles: shared/styles/components.css). */
import { h } from './dom';
import { button, type ButtonVariant } from './form';
import { showToast } from './toast';

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

/** Shows `data` as pretty-printed JSON with copy / close buttons. */
export function openJsonPreview(data: unknown, title = 'JSON Preview'): void {
  const json = JSON.stringify(data, null, 2);
  const dialog = h('dialog', { class: 'cs-json-dialog' });
  dialog.append(
    h(
      'div',
      { class: 'cs-json-dialog__header' },
      h('h3', { class: 'cs-json-dialog__title', text: title }),
      h(
        'div',
        { class: 'cs-json-dialog__actions' },
        button(
          'コピー',
          () => {
            void navigator.clipboard.writeText(json);
            showToast('JSONをクリップボードにコピーしました');
          },
          { size: 'dialog' },
        ),
        button('閉じる', () => dialog.close(), { size: 'dialog' }),
      ),
    ),
    h('pre', { text: json }),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  dialog.showModal();
}

/**
 * Lets Esc answer the dialog in `overlay` while it is the topmost one: `onEscape` runs and the key
 * goes no further, so the tool window (or a dialog below) stays open. Returns the function that
 * removes the overlay (and stops listening); call it however the dialog closes.
 */
export function escapeClosable(overlay: HTMLElement, onEscape: () => void): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelectorAll('.cs-modal-overlay--open, dialog[open]');
    if (open[open.length - 1] !== overlay) return;
    e.stopImmediatePropagation();
    onEscape();
  };
  // Capture phase: runs before the tool window's own Esc handler.
  document.addEventListener('keydown', onKeyDown, true);
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
  };
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
