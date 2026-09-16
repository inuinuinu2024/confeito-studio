import { icon } from '../../shared/utils/dom';

export function createToolBar(): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'left-toolbar';

  // State
  let isNormalMode = true;
  let isCompareMode = false;
  let isOverlayMode = false;
  let isBatchMode = false;

  // Normal Mode Button
  const normalBtn = document.createElement('div');
  normalBtn.className = 'left-toolbar__btn left-toolbar__btn--active';
  normalBtn.title = 'Normal Mode';
  normalBtn.appendChild(icon('image', 24));


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

  // Batch Mode Button
  const batchBtn = document.createElement('div');
  batchBtn.className = 'left-toolbar__btn';
  batchBtn.title = 'Batch Mode';
  batchBtn.appendChild(icon('grid_view', 24));

  function activateMode(mode: 'normal' | 'compare' | 'overlay' | 'batch') {
    if (mode === 'normal' && !isNormalMode) window.dispatchEvent(new CustomEvent('normal-mode:toggle', { detail: { enabled: true } }));
    if (mode !== 'normal' && isNormalMode) window.dispatchEvent(new CustomEvent('normal-mode:toggle', { detail: { enabled: false } }));

    if (mode === 'compare' && !isCompareMode) window.dispatchEvent(new CustomEvent('compare-mode:toggle', { detail: { enabled: true } }));
    if (mode !== 'compare' && isCompareMode) window.dispatchEvent(new CustomEvent('compare-mode:toggle', { detail: { enabled: false } }));

    if (mode === 'overlay' && !isOverlayMode) window.dispatchEvent(new CustomEvent('overlay-mode:toggle', { detail: { enabled: true } }));
    if (mode !== 'overlay' && isOverlayMode) window.dispatchEvent(new CustomEvent('overlay-mode:toggle', { detail: { enabled: false } }));

    if (mode === 'batch' && !isBatchMode) window.dispatchEvent(new CustomEvent('batch-mode:toggle', { detail: { enabled: true } }));
    if (mode !== 'batch' && isBatchMode) window.dispatchEvent(new CustomEvent('batch-mode:toggle', { detail: { enabled: false } }));
  }

  normalBtn.addEventListener('click', () => activateMode('normal'));
  compareBtn.addEventListener('click', () => {
    if (isCompareMode) activateMode('normal');
    else activateMode('compare');
  });
  overlayBtn.addEventListener('click', () => {
    if (isOverlayMode) activateMode('normal');
    else activateMode('overlay');
  });
  batchBtn.addEventListener('click', () => {
    if (isBatchMode) activateMode('normal');
    else activateMode('batch');
  });

  function ensureOneActive() {
    setTimeout(() => {
      if (!isNormalMode && !isCompareMode && !isOverlayMode && !isBatchMode) {
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

  window.addEventListener('batch-mode:toggle', (e: Event) => {
    const enabled = (e as CustomEvent).detail.enabled;
    if (isBatchMode !== enabled) {
      isBatchMode = enabled;
      batchBtn.classList.toggle('left-toolbar__btn--active', isBatchMode);
      if (!enabled) ensureOneActive();
    }
  });

  toolbar.appendChild(normalBtn);
  toolbar.appendChild(compareBtn);
  toolbar.appendChild(overlayBtn);
  toolbar.appendChild(batchBtn);

  return toolbar;
}
