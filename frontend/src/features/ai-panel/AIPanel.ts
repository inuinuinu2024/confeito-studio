/**
 * AIPanel — Right sidebar with ComfyUI controls:
 * prompts, parameter sliders, ControlNet adapters, and generate button.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';
import { ToolRegistry } from '../../shared/utils/ToolRegistry';

import { GrayscaleTool } from '../tools/grayscale';
import { NanoBananaProTool } from '../tools/nano-banana-pro';
import { NanoBanana2Tool } from '../tools/nano-banana-2';

import { createToolSettingsSidebar } from './components/ToolSettingsSidebar';
import { DocumentManager } from '../document/DocumentManager';
import { setImageCache, deleteImageCache } from '../../shared/utils/idb';
import { historyManager } from '../../shared/utils/history';
import { ToolContext } from '../../shared/types/tool.types';

// Register built-in tools
ToolRegistry.register(new GrayscaleTool());
ToolRegistry.register(new NanoBananaProTool());
ToolRegistry.register(new NanoBanana2Tool());


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



  // ── Views Container ──
  const viewsContainer = document.createElement('div');
  viewsContainer.className = 'ai-panel__views';
  viewsContainer.style.display = 'flex';
  viewsContainer.style.flexDirection = 'column';
  viewsContainer.style.flex = '1';
  viewsContainer.style.overflow = 'hidden';

  // ── AI Tools View ──
  const toolsView = document.createElement('div');
  toolsView.className = 'ai-panel__view';
  toolsView.style.display = 'flex';
  toolsView.style.flexDirection = 'column';
  toolsView.style.padding = '16px';
  toolsView.style.gap = '8px';


  
  const toolSettingsSidebar = createToolSettingsSidebar();
  document.body.appendChild(toolSettingsSidebar.overlay);

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
    
    if (tool.icon) {
      btn.appendChild(icon(tool.icon, 16));
    } else {
      const spacer = document.createElement('span');
      spacer.style.width = '16px';
      spacer.style.display = 'inline-block';
      btn.appendChild(spacer);
    }
    btn.appendChild(document.createTextNode(tool.name));

    if (tool.name === 'Nano Banana Pro') {
      const helpIcon = document.createElement('span');
      helpIcon.className = 'material-symbols-outlined';
      helpIcon.textContent = 'help';
      helpIcon.style.fontSize = '14px';
      helpIcon.style.color = 'var(--color-on-surface-variant)';
      helpIcon.style.marginLeft = 'auto';
      helpIcon.style.cursor = 'help';
      helpIcon.title = '高品質な画像生成を行う汎用ツールです';
      
      helpIcon.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      
      btn.appendChild(helpIcon);
    }

    btn.addEventListener('click', async () => {
      btn.style.transform = 'scale(0.97)';
      setTimeout(() => btn.style.transform = '', 120);

      const executeTool = async () => {
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
            return { prompt: pos };
          },
          cacheResult: async (image: HTMLCanvasElement | Blob, toolName: string, options?: { name?: string, folderId?: string }) => {
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
            const displayName = options?.name ?? `${dateStr}_${timeStr}_${toolName}`;
            
            const key = `ToolResult_${Date.now()}`;
            await setImageCache(key, blob, displayName, 'image', options?.folderId || null);
            
            historyManager.push({
               label: `AI生成結果を追加: ${displayName}`,
               execute: async () => {
                  await setImageCache(key, blob, displayName, 'image', options?.folderId || null);
                  window.dispatchEvent(new Event('tool:cache-updated'));
               },
               undo: async () => {
                  await deleteImageCache(key);
                  window.dispatchEvent(new Event('tool:cache-updated'));
               }
            });
            
            window.dispatchEvent(new CustomEvent('tool:result-ready', { detail: { key, toolName: displayName } }));
            window.dispatchEvent(new CustomEvent('tool:cache-updated', { detail: { autoSelectKey: key } }));
            return key;
          }
        };

        try {
          window.dispatchEvent(new CustomEvent('tool:start', { detail: { toolName: tool.name } }));
          await tool.execute(context);
          showToast(`${tool.name} completed.`, 'success');
          toolSettingsSidebar.close();
        } catch (err: any) {
          console.error(err);
          showToast(`${tool.name} failed: ${err.message || 'Unknown error'}`, 'error');
        } finally {
          window.dispatchEvent(new Event('tool:end'));
        }
      };

      if (tool.renderSettings) {
        toolSettingsSidebar.open(tool.name, tool.renderSettings.bind(tool), executeTool);
      } else {
        await executeTool();
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


  aside.appendChild(viewsContainer);

  return aside;
}

