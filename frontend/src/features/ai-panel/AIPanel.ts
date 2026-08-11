/**
 * AIPanel — Right sidebar with ComfyUI controls:
 * prompts, parameter sliders, ControlNet adapters, and generate button.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';
import { ToolRegistry } from '../../shared/utils/ToolRegistry';
import { InvertColorTool, GrayscaleTool } from '../tools/builtins';
import { GeminiGenerationTool } from '../tools/gemini';
import { createToolPromptDialog } from './components/ToolPromptDialog';
import { DocumentManager } from '../document/DocumentManager';
import { setImageCache } from '../../shared/utils/idb';
import { ToolContext } from '../../shared/types/tool.types';

// Register built-in tools
ToolRegistry.register(new InvertColorTool());
ToolRegistry.register(new GrayscaleTool());
ToolRegistry.register(new GeminiGenerationTool());

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

  let hiddenLayers = new Set<any>();
  window.addEventListener('layer:visibility', (e: Event) => {
    const customEvent = e as CustomEvent<{ hiddenLayers: Set<any> }>;
    hiddenLayers = customEvent.detail.hiddenLayers;
  });

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

  // ── Prompt Section ──
  const promptSection = document.createElement('div');
  promptSection.className = 'ai-panel__prompt-section';
  promptSection.style.display = 'flex';
  promptSection.style.flexDirection = 'column';
  promptSection.style.gap = '8px';
  promptSection.style.marginBottom = '16px';
  promptSection.style.padding = '0 16px'; // Optional padding

  // Main Prompt
  const posPrompt = createPromptSection(
    'Prompt',
    'masterpiece, best quality, highly detailed manga page, 1girl, cyberpunk aesthetic, ink lines, screentones, dramatic lighting',
    'ai-prompt__textarea--positive',
  );
  promptSection.appendChild(posPrompt);

  body.appendChild(promptSection);

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

  const toolPromptDialog = createToolPromptDialog();
  document.body.appendChild(toolPromptDialog.overlay);

  let tools = ToolRegistry.getAllTools();
  const savedOrderStr = localStorage.getItem('toolOrder');
  if (savedOrderStr) {
    try {
      const savedOrder = JSON.parse(savedOrderStr) as string[];
      tools.sort((a, b) => {
        const idxA = savedOrder.indexOf(a.name);
        const idxB = savedOrder.indexOf(b.name);
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });
    } catch (e) {
      console.error('Failed to parse tool order', e);
    }
  }

  let draggedItem: HTMLElement | null = null;

  for (const tool of tools) {
    const toolWrapper = document.createElement('div');
    toolWrapper.style.position = 'relative';
    toolWrapper.style.width = '100%';
    toolWrapper.style.cursor = 'grab';
    toolWrapper.draggable = true;
    toolWrapper.dataset.toolName = tool.name;

    // Drag and Drop Events
    toolWrapper.addEventListener('dragstart', (e) => {
      draggedItem = toolWrapper;
      setTimeout(() => {
        toolWrapper.style.opacity = '0.5';
      }, 0);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tool.name);
      }
    });

    toolWrapper.addEventListener('dragend', () => {
      setTimeout(() => {
        if (draggedItem) {
          draggedItem.style.opacity = '1';
        }
        draggedItem = null;
        // Clean up all borders
        Array.from(toolsView.children).forEach(child => {
          (child as HTMLElement).style.borderTop = '';
          (child as HTMLElement).style.borderBottom = '';
          (child as HTMLElement).style.transform = '';
        });
      }, 0);
    });

    toolWrapper.addEventListener('dragover', (e) => {
      e.preventDefault(); 
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      
      if (draggedItem && draggedItem !== toolWrapper) {
        const bounding = toolWrapper.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);
        
        // Reset borders
        toolWrapper.style.borderTop = '';
        toolWrapper.style.borderBottom = '';
        toolWrapper.style.transform = '';
        
        if (e.clientY > offset) {
          toolWrapper.style.borderBottom = '2px solid var(--color-primary)';
          toolWrapper.style.transform = 'translateY(-1px)';
        } else {
          toolWrapper.style.borderTop = '2px solid var(--color-primary)';
          toolWrapper.style.transform = 'translateY(1px)';
        }
      }
    });

    toolWrapper.addEventListener('dragleave', (e) => {
      // We don't reset borders here because child element hovering can trigger dragleave.
      // We handle cleanup in dragover of other elements or dragend/drop.
      // We only reset if we genuinely left the element entirely.
      const rect = toolWrapper.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        toolWrapper.style.borderTop = '';
        toolWrapper.style.borderBottom = '';
        toolWrapper.style.transform = '';
      }
    });

    toolWrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent toolsView drop from firing
      
      toolWrapper.style.borderTop = '';
      toolWrapper.style.borderBottom = '';
      toolWrapper.style.transform = '';
      
      if (draggedItem && draggedItem !== toolWrapper) {
        const bounding = toolWrapper.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);
        
        if (e.clientY > offset) {
          toolWrapper.after(draggedItem);
        } else {
          toolWrapper.before(draggedItem);
        }
        
        // Save new order
        const newOrder = Array.from(toolsView.children)
          .map(child => (child as HTMLElement).dataset?.toolName)
          .filter(Boolean) as string[];
        localStorage.setItem('toolOrder', JSON.stringify(newOrder));
      }
    });


    const btn = document.createElement('button');
    btn.className = 'ai-tool-btn';
    btn.style.width = '100%';
    
    // Only add padding if there's going to be an edit button
    if (tool.hasSettings) {
      btn.style.paddingRight = '32px'; 
    }
    
    btn.appendChild(icon(tool.icon, 16));
    btn.appendChild(document.createTextNode(tool.name));

    if (tool.hasSettings) {
      const editBtn = document.createElement('button');
      editBtn.className = 'ai-tool-btn';
      // Style as an icon button overlay
      editBtn.style.position = 'absolute';
      editBtn.style.right = '4px';
      editBtn.style.top = '50%';
      editBtn.style.transform = 'translateY(-50%)';
      editBtn.style.padding = '4px';
      editBtn.style.minHeight = 'unset';
      editBtn.style.height = '24px';
      editBtn.style.width = '24px';
      editBtn.style.display = 'flex';
      editBtn.style.alignItems = 'center';
      editBtn.style.justifyContent = 'center';
      editBtn.style.border = 'none';
      editBtn.style.background = 'transparent';
      editBtn.title = 'Edit Tool Prompts';
      // Use 'edit_note' for a notebook and pen icon
      editBtn.appendChild(icon('edit_note', 18));
      
      // Optional hover effect for the edit button
      editBtn.addEventListener('mouseenter', () => {
        editBtn.style.backgroundColor = 'var(--color-surface-container-high)';
        editBtn.style.borderRadius = '4px';
      });
      editBtn.addEventListener('mouseleave', () => {
        editBtn.style.backgroundColor = 'transparent';
      });
      
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 実行ボタンがクリックされるのを防ぐ
        toolPromptDialog.open(tool.name);
      });
      
      toolWrapper.appendChild(editBtn);
    }

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
        getCompositeImage: async () => {
          if (!psd || !psd.width || !psd.height) return null;
          const canvas = document.createElement('canvas');
          canvas.width = psd.width;
          canvas.height = psd.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          
          const drawNode = (node: any) => {
            if (hiddenLayers.has(node) || node.hidden) return;
            if (node.children) {
              for (let i = node.children.length - 1; i >= 0; i--) {
                drawNode(node.children[i]);
              }
            } else if (node.canvas) {
              ctx.drawImage(node.canvas, node.left || 0, node.top || 0);
            }
          };

          if (psd.children) {
            for (let i = psd.children.length - 1; i >= 0; i--) {
              drawNode(psd.children[i]);
            }
          }
          return canvas;
        },
        getPrompts: (toolName?: string) => {
          let pos = '';
          
          if (toolName) {
            pos = localStorage.getItem(`toolPrompt_${toolName}`) || '';
          }
          
          // Fallback to panel prompt if not defined per tool
          if (!pos) {
            pos = posPrompt.querySelector('textarea')?.value || '';
          }
          
          return { prompt: pos };
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
        window.dispatchEvent(new CustomEvent('tool:start', { detail: { toolName: tool.name } }));
        await tool.execute(context);
        showToast(`${tool.name} completed.`, 'success');
      } catch (err: any) {
        console.error(err);
        showToast(`${tool.name} failed: ${err.message || 'Unknown error'}`, 'error');
      } finally {
        window.dispatchEvent(new Event('tool:end'));
      }
    });

    toolWrapper.appendChild(btn);
    toolsView.appendChild(toolWrapper);
  }

  // Allow dropping on the empty space at the bottom of toolsView
  toolsView.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    
    if (draggedItem && (e.target === toolsView || (e.target as HTMLElement).classList.contains('ai-panel__view'))) {
      const children = Array.from(toolsView.children).filter(c => (c as HTMLElement).dataset?.toolName);
      if (children.length > 0) {
        const lastChild = children[children.length - 1] as HTMLElement;
        if (lastChild !== draggedItem) {
          lastChild.style.borderBottom = '2px solid var(--color-primary)';
        }
      }
    }
  });

  toolsView.addEventListener('dragleave', (e) => {
    // Reset any borderBottom we might have added to the last child
    const children = Array.from(toolsView.children).filter(c => (c as HTMLElement).dataset?.toolName);
    if (children.length > 0) {
      const lastChild = children[children.length - 1] as HTMLElement;
      lastChild.style.borderBottom = '';
    }
  });

  toolsView.addEventListener('drop', (e) => {
    e.preventDefault();
    
    // Reset border
    const children = Array.from(toolsView.children).filter(c => (c as HTMLElement).dataset?.toolName);
    if (children.length > 0) {
      const lastChild = children[children.length - 1] as HTMLElement;
      lastChild.style.borderBottom = '';
    }
    
    // Only handle if we dropped directly on toolsView (e.g. empty space at the bottom)
    // and not on a specific toolWrapper which handles its own drop
    if (draggedItem && (e.target === toolsView || (e.target as HTMLElement).classList.contains('ai-panel__view'))) {
      toolsView.appendChild(draggedItem);
      
      const newOrder = Array.from(toolsView.children)
        .map(child => (child as HTMLElement).dataset?.toolName)
        .filter(Boolean) as string[];
      localStorage.setItem('toolOrder', JSON.stringify(newOrder));
    }
  });

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
