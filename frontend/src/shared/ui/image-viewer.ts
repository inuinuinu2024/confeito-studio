/**
 * A window in the app that shows one image large (fitted to the window, keeping its aspect ratio),
 * only to look at it: ×, Esc and a click outside the image close it and nothing else changes.
 * Styles: shared/styles/components.css (cs-image-viewer).
 */
import { escapeClosable } from './dialogs';
import { h, icon } from './dom';

export function openImageViewer(src: string, title: string): void {
  const closeButton = h('button', { class: 'cs-image-viewer__close', title: '閉じる' }, icon('close', 20));
  const panel = h(
    'div',
    { class: 'cs-image-viewer', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } },
    h(
      'div',
      { class: 'cs-image-viewer__head' },
      h('span', { class: 'cs-image-viewer__title', text: title }),
      closeButton,
    ),
    h('div', { class: 'cs-image-viewer__body' }, h('img', { class: 'cs-image-viewer__img', src, alt: title })),
  );
  const overlay = h('div', { class: 'cs-modal-overlay cs-modal-overlay--open cs-image-viewer-overlay' }, panel);
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const close = () => {
    remove();
    returnFocus?.focus();
  };
  closeButton.addEventListener('click', close);
  // Outside the image (the backdrop or the empty part of the window) closes it too.
  overlay.addEventListener('click', e => {
    if (e.target === overlay || (e.target as HTMLElement).classList.contains('cs-image-viewer__body')) close();
  });
  document.body.appendChild(overlay);
  const remove = escapeClosable(overlay, close);
  closeButton.focus();
}
