/**
 * AIPanel — Right sidebar with ComfyUI controls:
 * prompts, parameter sliders, ControlNet adapters, and generate button.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';
import { ToolRegistry } from '../../shared/utils/ToolRegistry';
import { InvertColorTool, GrayscaleTool } from '../tools/builtins';
import { DocumentManager } from '../document/DocumentManager';
import { setImageCache } from '../../shared/utils/idb';
import { ToolContext } from '../../shared/types/tool.types';

// Register built-in tools
ToolRegistry.register(new InvertColorTool());
ToolRegistry.register(new GrayscaleTool());

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

  // ── Resizer ──
  const resizer = document.createElement('div');
  resizer.className = 'ai-panel__resizer';
  
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = aside.getBoundingClientRect().width;
    document.body.style.cursor = 'ew-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = startWidth - (e.clientX - startX);
    if (newWidth > 150 && newWidth < 600) {
      document.documentElement.style.setProperty('--right-sidebar-width', `${newWidth}px`);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
    }
  });

  aside.appendChild(resizer);

  // ── Activity Indicator ──
  const indicator = document.createElement('div');
  indicator.className = 'ai-panel__indicator';
  const indicatorBar = document.createElement('div');
  indicatorBar.className = 'ai-panel__indicator-bar';
  indicator.appendChild(indicatorBar);
  aside.appendChild(indicator);

  // ── Tabs ──
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'ai-panel__tabs';

  const toolsTab = document.createElement('button');
  toolsTab.className = 'ai-panel__tab ai-panel__tab--active';
  toolsTab.textContent = 'Tools';

  const chatTab = document.createElement('button');
  chatTab.className = 'ai-panel__tab';
  chatTab.textContent = 'Chat';

  const comfyTab = document.createElement('button');
  comfyTab.className = 'ai-panel__tab';
  comfyTab.textContent = 'ComfyUI';

  tabsContainer.appendChild(toolsTab);
  tabsContainer.appendChild(chatTab);
  tabsContainer.appendChild(comfyTab);
  aside.appendChild(tabsContainer);

  // ── Views Container ──
  const viewsContainer = document.createElement('div');
  viewsContainer.className = 'ai-panel__views';
  viewsContainer.style.display = 'flex';
  viewsContainer.style.flexDirection = 'column';
  viewsContainer.style.flex = '1';
  viewsContainer.style.overflow = 'hidden';

  // ── ComfyUI View ──
  const comfyView = document.createElement('div');
  comfyView.className = 'ai-panel__view';
  comfyView.style.display = 'none';
  comfyView.style.flexDirection = 'column';
  comfyView.style.flex = '1';
  comfyView.style.overflow = 'hidden';

  // Footer: Generate Button
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

  // Body
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

  comfyView.appendChild(body);
  comfyView.appendChild(footer);
  viewsContainer.appendChild(comfyView);

  // ── AI Tools View ──
  const toolsView = document.createElement('div');
  toolsView.className = 'ai-panel__view';
  toolsView.style.display = 'flex';
  toolsView.style.flexDirection = 'column';
  toolsView.style.padding = '16px';
  toolsView.style.gap = '8px';



  const tools = ToolRegistry.getAllTools();
  for (const tool of tools) {
    const btn = document.createElement('button');
    btn.className = 'ai-tool-btn';
    btn.appendChild(icon(tool.icon, 16));
    btn.appendChild(document.createTextNode(tool.name));

    btn.addEventListener('click', async () => {
      btn.style.transform = 'scale(0.97)';
      setTimeout(() => btn.style.transform = '', 120);

      const docManager = DocumentManager.getInstance();
      const psd = docManager.getCurrentPsd();
      const selectedLayer = docManager.getCurrentSelectedLayer();

      const context: ToolContext = {
        psd,
        selectedLayer,
        getSelectedImage: async () => {
          if (!selectedLayer || !selectedLayer.canvas) {
            return null;
          }
          // Clone the canvas to avoid modifying the original layer preview immediately
          const canvas = document.createElement('canvas');
          canvas.width = selectedLayer.canvas.width;
          canvas.height = selectedLayer.canvas.height;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(selectedLayer.canvas, 0, 0);
          return canvas;
        },
        cacheResult: async (image: HTMLCanvasElement | Blob, toolName: string) => {
          let canvasToAdd: HTMLCanvasElement;
          let blob: Blob;

          if (image instanceof HTMLCanvasElement) {
            canvasToAdd = image;
            blob = await new Promise<Blob | null>(res => image.toBlob(res)) as Blob;
          } else {
            blob = image;
            canvasToAdd = await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                const cvs = document.createElement('canvas');
                cvs.width = img.width;
                cvs.height = img.height;
                cvs.getContext('2d')?.drawImage(img, 0, 0);
                resolve(cvs);
              };
              img.onerror = reject;
              img.src = URL.createObjectURL(blob);
            });
          }

          if (!blob) throw new Error('Failed to create blob from canvas');
          
          const date = new Date();
          const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
          const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
          const displayName = `${dateStr}_${timeStr}_${toolName}`;
          
          const key = `ToolResult_${Date.now()}`;
          await setImageCache(key, blob, displayName);
          
          // Dispatch event for Canvas and LayerPanel to update
          window.dispatchEvent(new CustomEvent('tool:result-ready', { detail: { key, toolName: displayName } }));
          window.dispatchEvent(new CustomEvent('tool:cache-updated', { detail: { autoSelectKey: key } }));
          return key;
        }
      };

      try {
        await tool.execute(context);
        showToast(`${tool.name} completed.`, 'success');
      } catch (err: any) {
        console.error(err);
        showToast(`${tool.name} failed: ${err.message || 'Unknown error'}`, 'error');
      }
    });

    toolsView.appendChild(btn);
  }

  viewsContainer.appendChild(toolsView);

  // ── Chatbot View (Placeholder) ──
  const chatView = document.createElement('div');
  chatView.className = 'ai-panel__view';
  chatView.style.display = 'none';
  chatView.style.padding = '16px';
  chatView.style.color = 'var(--color-on-surface-variant)';
  chatView.textContent = 'Chat interface goes here.';
  viewsContainer.appendChild(chatView);

  aside.appendChild(viewsContainer);

  // Tab switching logic
  const tabs = [toolsTab, chatTab, comfyTab];
  const views = [toolsView, chatView, comfyView];

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('ai-panel__tab--active'));
      views.forEach(v => v.style.display = 'none');

      tab.classList.add('ai-panel__tab--active');
      views[index].style.display = 'flex';
    });
  });

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
