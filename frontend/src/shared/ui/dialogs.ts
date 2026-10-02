/** Modal dialogs (styles: shared/styles/components.css). */
import { h } from './dom';
import { button } from './form';
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

/** Multi-line text editor in a modal (e.g. the default prompt). */
export function openTextEditDialog(opts: { title: string; value: string; onSave: (value: string) => void }): void {
  const textarea = h('textarea', { class: 'cs-textarea', value: opts.value });
  const modal = createModal({ title: opts.title, closeOnBackdrop: false });
  const dispose = () => modal.overlay.remove();
  modal.panel.append(
    textarea,
    h(
      'div',
      { class: 'cs-modal__actions' },
      button('キャンセル', dispose, { variant: 'outline', size: 'dialog' }),
      button(
        '保存',
        () => {
          opts.onSave(textarea.value);
          dispose();
        },
        { variant: 'primary', size: 'dialog' },
      ),
    ),
  );
  modal.open();
  textarea.focus();
}
