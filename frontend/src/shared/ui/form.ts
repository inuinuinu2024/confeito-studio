/**
 * Form controls for tool settings in the tool window (styles: shared/styles/components.css).
 * Controls that persist a value take the current value and an onChange callback;
 * persistence itself is done by the caller (usually via toolSettings()).
 */
import { h, icon } from './dom';

export interface Option {
  value: string;
  label: string;
}

/** "?" icon whose tooltip explains a setting. */
export function helpIcon(text: string): HTMLSpanElement {
  const el = icon('help');
  el.className = 'material-symbols-outlined cs-help';
  el.title = text;
  return el;
}

/** Label (+ optional help icon) above a control. */
export function field(label: string, control: HTMLElement, help?: string): HTMLDivElement {
  return h(
    'div',
    { class: 'cs-field' },
    h(
      'div',
      { class: 'cs-field__label-row' },
      h('label', { class: 'cs-field__label', text: label }),
      help ? helpIcon(help) : null,
    ),
    control,
  );
}

export function select(options: Option[], value: string, onChange: (value: string) => void): HTMLSelectElement {
  const el = h('select', { class: 'cs-select' }, ...options.map(o => h('option', { value: o.value, text: o.label })));
  el.value = value;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export interface SliderControl {
  el: HTMLDivElement;
  /** Updates the slider and its label without firing onInput. */
  setValue(value: string): void;
}

export function slider(opts: {
  min: number;
  max: number;
  step?: number;
  value: string;
  format?: (value: string) => string;
  onInput: (value: string) => void;
}): SliderControl {
  const format = opts.format ?? (v => v);
  const input = h('input', {
    type: 'range',
    min: String(opts.min),
    max: String(opts.max),
    step: String(opts.step ?? 1),
  });
  input.value = opts.value;
  const label = h('span', { class: 'cs-slider__value', text: format(input.value) });
  input.addEventListener('input', () => {
    label.textContent = format(input.value);
    opts.onInput(input.value);
  });
  return {
    el: h('div', { class: 'cs-slider' }, input, label),
    setValue(value) {
      input.value = value;
      label.textContent = format(value);
    },
  };
}

export interface SwitchControl {
  el: HTMLDivElement;
  setValue(on: boolean): void;
}

/** On/off switch (`.toggle`) with a clickable label. */
export function switchRow(
  label: string,
  value: boolean,
  onChange: (on: boolean) => void,
  help?: string,
): SwitchControl {
  let on = value;
  const knob = h('div', { class: 'toggle' }, h('div', { class: 'toggle__knob' }));
  const render = () => {
    knob.classList.toggle('toggle--on', on);
    knob.classList.toggle('toggle--off', !on);
  };
  const flip = () => {
    on = !on;
    render();
    onChange(on);
  };
  const text = h('label', { class: 'cs-switch-row__label', text: label, onclick: flip });
  knob.addEventListener('click', flip);
  render();
  return {
    el: h(
      'div',
      { class: 'cs-switch-row' },
      knob,
      h('div', { class: 'cs-field__label-row' }, text, help ? helpIcon(help) : null),
    ),
    setValue(next) {
      on = next;
      render();
    },
  };
}

type ButtonVariant = 'default' | 'outline' | 'primary';

export function button(
  text: string,
  onClick: (e: MouseEvent) => void,
  opts: { variant?: ButtonVariant; block?: boolean; size?: 'small' | 'dialog'; title?: string } = {},
): HTMLButtonElement {
  const classes = ['cs-btn'];
  if (opts.variant && opts.variant !== 'default') classes.push(`cs-btn--${opts.variant}`);
  if (opts.block) classes.push('cs-btn--block');
  if (opts.size) classes.push(`cs-btn--${opts.size}`);
  return h('button', { class: classes.join(' '), text, title: opts.title ?? '', onclick: onClick });
}

export function iconButton(
  name: string,
  title: string,
  onClick: (e: MouseEvent) => void,
  size = 14,
): HTMLButtonElement {
  return h('button', { class: 'cs-icon-btn', title, onclick: onClick }, icon(name, size));
}

export function note(text: string): HTMLDivElement {
  return h('div', { class: 'cs-note', text });
}
