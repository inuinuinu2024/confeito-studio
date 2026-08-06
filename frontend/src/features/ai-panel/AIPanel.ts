/**
 * AIPanel — Right sidebar with ComfyUI controls:
 * prompts, parameter sliders, ControlNet adapters, and generate button.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';

interface SliderDef {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
}

const sliders: SliderDef[] = [
  { label: 'Denoising Strength', value: 65, min: 0, max: 100, step: 1, display: '0.65' },
  { label: 'CFG Scale',          value: 70, min: 0, max: 100, step: 1, display: '7.0' },
];

interface ControlNetDef {
  iconName: string;
  name: string;
  enabled: boolean;
}

const controlNets: ControlNetDef[] = [
  { iconName: 'gesture', name: 'Lineart (Anime)', enabled: true },
  { iconName: 'draw',    name: 'Scribble',        enabled: false },
];

export function createAIPanel(): HTMLElement {
  const aside = document.createElement('aside');
  aside.className = 'ai-panel';

  // ── Activity Indicator ──
  const indicator = document.createElement('div');
  indicator.className = 'ai-panel__indicator';
  const indicatorBar = document.createElement('div');
  indicatorBar.className = 'ai-panel__indicator-bar';
  indicator.appendChild(indicatorBar);
  aside.appendChild(indicator);

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'ai-panel__header';
  const headerIcon = icon('smart_toy', 18);
  headerIcon.className = 'material-symbols-outlined ai-panel__header-icon';
  header.appendChild(headerIcon);
  const headerTitle = document.createElement('span');
  headerTitle.className = 'ai-panel__header-title';
  headerTitle.textContent = 'ComfyUI Controls';
  header.appendChild(headerTitle);
  aside.appendChild(header);

  // ── Body ──
  const body = document.createElement('div');
  body.className = 'ai-panel__body';

  // Positive Prompt
  const posPrompt = createPromptSection(
    'Positive Prompt',
    'masterpiece, best quality, highly detailed manga page, 1girl, cyberpunk aesthetic, ink lines, screentones, dramatic lighting',
    'ai-prompt__textarea--positive',
  );
  body.appendChild(posPrompt);

  // Negative Prompt
  const negPrompt = createPromptSection(
    'Negative Prompt',
    'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality',
    'ai-prompt__textarea--negative',
  );
  body.appendChild(negPrompt);

  // Divider
  body.appendChild(createDivider());

  // Parameter Sliders
  const params = document.createElement('div');
  params.className = 'ai-params';
  for (const slider of sliders) {
    params.appendChild(createSlider(slider));
  }
  body.appendChild(params);

  // Divider
  body.appendChild(createDivider());

  // ControlNet Adapters
  const controlnet = document.createElement('div');
  controlnet.className = 'ai-controlnet';

  const cnTitle = document.createElement('label');
  cnTitle.className = 'ai-controlnet__title';
  cnTitle.textContent = 'ControlNet Adapters';
  controlnet.appendChild(cnTitle);

  for (const cn of controlNets) {
    controlnet.appendChild(createControlNetItem(cn));
  }
  body.appendChild(controlnet);

  aside.appendChild(body);

  // ── Footer: Generate Button ──
  const footer = document.createElement('div');
  footer.className = 'ai-panel__footer';

  const genBtn = document.createElement('button');
  genBtn.className = 'ai-generate-btn';
  genBtn.appendChild(icon('auto_awesome'));
  genBtn.appendChild(document.createTextNode('Generate with ComfyUI'));

  genBtn.addEventListener('click', () => {
    genBtn.style.transform = 'scale(0.97)';
    setTimeout(() => {
      genBtn.style.transform = '';
    }, 120);
    showToast('ComfyUI 生成', true);
  });

  footer.appendChild(genBtn);
  aside.appendChild(footer);

  return aside;
}

// ── Helpers ──

function createPromptSection(
  labelText: string,
  defaultValue: string,
  sizeClass: string,
): HTMLElement {
  const section = document.createElement('div');
  section.className = 'ai-prompt';

  const label = document.createElement('label');
  label.className = 'ai-prompt__label';
  label.textContent = labelText;
  section.appendChild(label);

  const textarea = document.createElement('textarea');
  textarea.className = `ai-prompt__textarea ${sizeClass}`;
  textarea.placeholder = `Enter ${labelText.toLowerCase()}...`;
  textarea.value = defaultValue;
  section.appendChild(textarea);

  return section;
}

function createSlider(def: SliderDef): HTMLElement {
  const container = document.createElement('div');
  container.className = 'ai-param';

  const header = document.createElement('div');
  header.className = 'ai-param__header';

  const label = document.createElement('label');
  label.className = 'ai-param__label';
  label.textContent = def.label;
  header.appendChild(label);

  const valueDisplay = document.createElement('span');
  valueDisplay.className = 'ai-param__value';
  valueDisplay.textContent = def.display;
  header.appendChild(valueDisplay);

  container.appendChild(header);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(def.min);
  slider.max = String(def.max);
  slider.step = String(def.step);
  slider.value = String(def.value);

  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    if (def.label === 'Denoising Strength') {
      valueDisplay.textContent = (v / 100).toFixed(2);
    } else {
      valueDisplay.textContent = (v / 10).toFixed(1);
    }
  });

  container.appendChild(slider);
  return container;
}

function createControlNetItem(def: ControlNetDef): HTMLElement {
  const item = document.createElement('div');
  item.className = 'ai-controlnet__item';

  const left = document.createElement('div');
  left.className = 'ai-controlnet__item-left';

  const cnIcon = icon(def.iconName, 16);
  cnIcon.classList.add('ai-controlnet__item-icon');
  left.appendChild(cnIcon);

  const name = document.createElement('span');
  name.className = 'ai-controlnet__item-name';
  name.textContent = def.name;
  left.appendChild(name);

  item.appendChild(left);

  // Toggle
  const toggle = document.createElement('div');
  toggle.className = `toggle ${def.enabled ? 'toggle--on' : 'toggle--off'}`;
  const knob = document.createElement('div');
  knob.className = 'toggle__knob';
  toggle.appendChild(knob);

  toggle.addEventListener('click', () => {
    toggle.classList.toggle('toggle--on');
    toggle.classList.toggle('toggle--off');
  });

  item.appendChild(toggle);

  return item;
}

function createDivider(): HTMLElement {
  const div = document.createElement('div');
  div.className = 'ai-panel__divider';
  return div;
}
