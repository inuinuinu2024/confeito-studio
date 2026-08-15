import { icon } from '../../shared/utils/dom';

export function createToolBar(): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'left-toolbar';

  // State
  let isNormalMode = true;
  let isCompareMode = false;
  let isOverlayMode = false;

  // Normal Mode Button
  const normalBtn = document.createElement('div');
  normalBtn.className = 'left-toolbar__btn left-toolbar__btn--active';
  normalBtn.title = 'Normal Mode';
  normalBtn.appendChild(icon('image', 24));

  // Divider
  const divider = document.createElement('div');
  divider.className = 'left-toolbar__divider';

  // Compare Mode Button
  const compareBtn = document.createElement('div');
  compareBtn.className = 'left-toolbar__btn';
  compareBtn.title = 'Compare Mode';
  compareBtn.appendChild(icon('compare', 24));

  // Overlay Button
  const overlayBtn = document.createElement('div');
  overlayBtn.className = 'left-toolbar__btn';
  overlayBtn.title = 'Overlay Mode';
  overlayBtn.appendChild(icon('photo_library', 24));

  function activateMode(mode: 'normal' | 'compare' | 'overlay') {
    if (mode === 'normal' && !isNormalMode) window.dispatchEvent(new CustomEvent('normal-mode:toggle', { detail: { enabled: true } }));
    if (mode !== 'normal' && isNormalMode) window.dispatchEvent(new CustomEvent('normal-mode:toggle', { detail: { enabled: false } }));

    if (mode === 'compare' && !isCompareMode) window.dispatchEvent(new CustomEvent('compare-mode:toggle', { detail: { enabled: true } }));
    if (mode !== 'compare' && isCompareMode) window.dispatchEvent(new CustomEvent('compare-mode:toggle', { detail: { enabled: false } }));

    if (mode === 'overlay' && !isOverlayMode) window.dispatchEvent(new CustomEvent('overlay-mode:toggle', { detail: { enabled: true } }));
    if (mode !== 'overlay' && isOverlayMode) window.dispatchEvent(new CustomEvent('overlay-mode:toggle', { detail: { enabled: false } }));
  }

  normalBtn.addEventListener('click', () => activateMode('normal'));
  compareBtn.addEventListener('click', () => activateMode('compare'));
  overlayBtn.addEventListener('click', () => activateMode('overlay'));

  function ensureOneActive() {
    setTimeout(() => {
      if (!isNormalMode && !isCompareMode && !isOverlayMode) {
        window.dispatchEvent(new CustomEvent('normal-mode:toggle', { detail: { enabled: true } }));
      }
    }, 10);
  }

  // Listen to external events just in case
  window.addEventListener('normal-mode:toggle', (e: Event) => {
    const enabled = (e as CustomEvent).detail.enabled;
    if (isNormalMode !== enabled) {
      isNormalMode = enabled;
      normalBtn.classList.toggle('left-toolbar__btn--active', isNormalMode);
      if (!enabled) ensureOneActive();
    }
  });

  window.addEventListener('compare-mode:toggle', (e: Event) => {
    const enabled = (e as CustomEvent).detail.enabled;
    if (isCompareMode !== enabled) {
      isCompareMode = enabled;
      compareBtn.classList.toggle('left-toolbar__btn--active', isCompareMode);
      if (!enabled) ensureOneActive();
    }
  });

  window.addEventListener('overlay-mode:toggle', (e: Event) => {
    const enabled = (e as CustomEvent).detail.enabled;
    if (isOverlayMode !== enabled) {
      isOverlayMode = enabled;
      overlayBtn.classList.toggle('left-toolbar__btn--active', isOverlayMode);
      if (!enabled) ensureOneActive();
    }
  });

  toolbar.appendChild(normalBtn);
  toolbar.appendChild(divider);
  toolbar.appendChild(compareBtn);
  toolbar.appendChild(overlayBtn);

  return toolbar;
}
