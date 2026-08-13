import { icon } from '../../shared/utils/dom';

export function createToolBar(): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'left-toolbar';

  // Compare Mode Button
  const compareBtn = document.createElement('div');
  compareBtn.className = 'left-toolbar__btn';
  compareBtn.title = 'Compare Mode';
  compareBtn.appendChild(icon('splitscreen_right', 24));

  let isCompareMode = false;
  compareBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('compare-mode:toggle', { detail: { enabled: !isCompareMode } }));
  });

  // Slider Button
  const sliderBtn = document.createElement('div');
  sliderBtn.className = 'left-toolbar__btn';
  sliderBtn.title = 'Slider Mode';
  sliderBtn.appendChild(icon('compare', 24));

  let isSliderMode = false;
  sliderBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('slider-mode:toggle', { detail: { enabled: !isSliderMode } }));
  });

  // Listen to external events just in case
  window.addEventListener('compare-mode:toggle', (e: Event) => {
    const enabled = (e as CustomEvent).detail.enabled;
    if (isCompareMode !== enabled) {
      isCompareMode = enabled;
      compareBtn.classList.toggle('left-toolbar__btn--active', isCompareMode);
    }
  });

  window.addEventListener('slider-mode:toggle', (e: Event) => {
    const enabled = (e as CustomEvent).detail.enabled;
    if (isSliderMode !== enabled) {
      isSliderMode = enabled;
      sliderBtn.classList.toggle('left-toolbar__btn--active', isSliderMode);
    }
  });

  toolbar.appendChild(compareBtn);
  toolbar.appendChild(sliderBtn);

  return toolbar;
}
