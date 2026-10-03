/** Floating toolbar groups at the top of the canvas (Parallel options and Overlay options). */
import { h, icon } from '../../shared/ui/dom';
import { TINT_COLORS } from './render';

export interface ToggleSwitch {
  el: HTMLDivElement;
  set(on: boolean): void;
}

function toggleSwitch(onClick: () => void): ToggleSwitch {
  const el = h('div', { class: 'toggle toggle--off', onclick: onClick }, h('div', { class: 'toggle__knob' }));
  return {
    el,
    set(on) {
      el.classList.toggle('toggle--on', on);
      el.classList.toggle('toggle--off', !on);
    },
  };
}

const label = (text: string) => h('span', { class: 'canvas-toolbar__label', text });
const spacer = () => h('div', { class: 'canvas-toolbar__spacer' });

export interface ParallelToolbar {
  el: HTMLDivElement;
  slider: ToggleSwitch;
  vertical: ToggleSwitch;
  flip: ToggleSwitch;
  /** Transpose / Flip are only shown while the slider is on. */
  showSliderOptions(visible: boolean): void;
}

export function createParallelToolbar(handlers: {
  onSlider: () => void;
  onVertical: () => void;
  onFlip: () => void;
}): ParallelToolbar {
  const slider = toggleSwitch(handlers.onSlider);
  const vertical = toggleSwitch(handlers.onVertical);
  const flip = toggleSwitch(handlers.onFlip);
  const sliderOptions = [spacer(), label('Transpose'), vertical.el, spacer(), label('Flip'), flip.el];
  return {
    el: h('div', { class: 'canvas-toolbar__group' }, label('Slider'), slider.el, ...sliderOptions),
    slider,
    vertical,
    flip,
    showSliderOptions(visible) {
      for (const el of sliderOptions) el.style.display = visible ? '' : 'none';
    },
  };
}

export function createOverlayToolbar(handlers: {
  initialTint: string | null;
  onTint: (tint: string | null) => void;
  onOpacity: (percent: number) => void;
  onResetPosition: () => void;
}): HTMLDivElement {
  let tint = handlers.initialTint;
  const swatches = Object.entries(TINT_COLORS).map(([id, hex]) =>
    h('div', {
      class: 'canvas-toolbar__swatch',
      style: { backgroundColor: hex },
      onclick: () => {
        tint = tint === id ? null : id; // clicking the active colour shows the original colours
        render();
        handlers.onTint(tint);
      },
      dataset: { tint: id },
    }),
  );
  const render = () =>
    swatches.forEach(s => s.classList.toggle('canvas-toolbar__swatch--active', s.dataset.tint === tint));
  render();

  const opacityLabel = h('span', { class: 'canvas-toolbar__label canvas-toolbar__opacity-value', text: '50%' });
  const opacity = h('input', { class: 'canvas-toolbar__opacity', type: 'range', min: '0', max: '100', value: '50' });
  opacity.addEventListener('input', () => {
    const value = parseInt(opacity.value, 10);
    opacityLabel.textContent = `${value}%`;
    handlers.onOpacity(value);
  });

  return h(
    'div',
    { class: 'canvas-toolbar__group' },
    label('Underdrawing'),
    h('div', { class: 'canvas-toolbar__swatches' }, ...swatches),
    spacer(),
    label('Top'),
    opacity,
    opacityLabel,
    h(
      'div',
      { class: 'canvas-toolbar__reset', title: '上絵の位置をリセット', onclick: handlers.onResetPosition },
      icon('home', 18),
    ),
  );
}
