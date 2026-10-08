/**
 * 別ウィンドウ (docs/specs/app-shell.md 「別ウィンドウ」): the one look and behaviour of every window opened over the
 * app — the colors of the tool window, the title at the top left and × at the top right of the header, the content
 * below, action buttons (if any) in a footer. ×, Esc (while it is the topmost window) and a click outside it close it
 * without asking; a drag that starts inside and ends outside does not.
 * Styles: shared/styles/components.css (cs-window). The tool window and the settings window share the look
 * (components/ToolWindow.ts, SettingsWindow.ts); question dialogs (confirmDialog / choiceDialog) are not windows.
 */
import { h, icon } from './dom';

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

export interface AppWindowOptions {
  title: string;
  /** Material icon before the title. */
  icon?: string;
  /** Extra class of the window (its size, its own layout). */
  className?: string;
  /** Header controls between the title and × (e.g. zoom buttons). */
  headerTools?: (Node | null)[];
  /** Called once, however the window closes. */
  onClose?: () => void;
}

export interface AppWindow {
  overlay: HTMLDivElement;
  panel: HTMLDivElement;
  /** The content area (scrolls when it is taller than the window). */
  body: HTMLDivElement;
  /** Appends a footer with these buttons (right-aligned) below the body. */
  footer(...buttons: (HTMLElement | null)[]): HTMLDivElement;
  close(): void;
}

export function openWindow(opts: AppWindowOptions): AppWindow {
  const closeButton = h('button', { class: 'cs-window__close', title: '閉じる' }, icon('close', 20));
  const title = h('h2', { class: 'cs-window__title', text: opts.title });
  const body = h('div', { class: 'cs-window__body' });
  const panel = h(
    'div',
    {
      class: `cs-window${opts.className ? ` ${opts.className}` : ''}`,
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title },
    },
    h(
      'div',
      { class: 'cs-window__header' },
      h('div', { class: 'cs-window__heading' }, opts.icon ? icon(opts.icon, 20) : null, title),
      ...(opts.headerTools ?? []),
      closeButton,
    ),
    body,
  );
  const overlay = h('div', { class: 'cs-modal-overlay cs-modal-overlay--open cs-window-overlay' }, panel);

  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    remove();
    opts.onClose?.();
    returnFocus?.focus();
  };
  closeButton.addEventListener('click', close);
  // A click that starts and ends outside the window closes it (dragging out of the window does not count).
  let pressedOutside = false;
  overlay.addEventListener('pointerdown', e => (pressedOutside = e.target === overlay));
  overlay.addEventListener('click', e => {
    if (pressedOutside && e.target === overlay) close();
    pressedOutside = false;
  });

  document.body.appendChild(overlay);
  const remove = escapeClosable(overlay, close);
  closeButton.focus();

  return {
    overlay,
    panel,
    body,
    footer: (...buttons) => {
      const footer = h('div', { class: 'cs-window__footer' }, ...buttons);
      panel.append(footer);
      return footer;
    },
    close,
  };
}
