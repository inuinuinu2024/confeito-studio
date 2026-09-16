/**
 * AIPanel — Right sidebar with ComfyUI controls:
 * prompts, parameter sliders, ControlNet adapters, and generate button.
 */
import { icon } from '../../shared/utils/dom';

import { saveArchive, appendArchiveLog } from '../../shared/utils/archives';
import { showToast } from '../../shared/utils/toast';
import { ToolRegistry } from '../../shared/utils/ToolRegistry';

import { getGlobalSetting } from '../../shared/utils/settings';
import { NanoBananaProTool } from '../tools/nano-banana-pro';
import { NanoBanana2Tool } from '../tools/nano-banana-2';
import { ColoringTool } from '../tools/coloring';
import { RemoveBackgroundTool } from '../tools/remove-background';
import { ImageLoaderTool } from '../tools/image-loader';
import { PanelSplitterTool } from '../tools/panel-splitter';
import { PanelMergeTool } from '../tools/panel-merge';

import { createToolSettingsSidebar } from './components/ToolSettingsSidebar';
import { DocumentManager } from '../document/DocumentManager';

import { historyManager } from '../../shared/utils/history';
import { ToolContext } from '../../shared/types/tool.types';

// Register built-in tools
ToolRegistry.register(new ImageLoaderTool());
ToolRegistry.register(new PanelSplitterTool());
ToolRegistry.register(new NanoBananaProTool());
ToolRegistry.register(new NanoBanana2Tool());
ToolRegistry.register(new ColoringTool());
ToolRegistry.register(new RemoveBackgroundTool());
ToolRegistry.register(new PanelMergeTool());


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

  // ── State Management ──
  let activeTab: 'all' | 'custom' = (localStorage.getItem('aiPanelActiveTab') as 'all' | 'custom') || 'all';

  let customToolNames: string[] = [];
  const savedCustomOrderStr = localStorage.getItem('customToolOrder');
  if (savedCustomOrderStr) {
    try {
      customToolNames = JSON.parse(savedCustomOrderStr) as string[];
    } catch (e) {
      console.error('Failed to parse custom tool order', e);
    }
  } else {
    // Default initial custom tools
    const allTools = ToolRegistry.getAllTools();
    customToolNames = ['Coloring', 'Nano Banana Pro'].filter(name => allTools.some(t => t.name === name));
    localStorage.setItem('customToolOrder', JSON.stringify(customToolNames));
  }

  const getAllOrderedTools = () => {
    const tools = ToolRegistry.getAllTools();
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
    return tools;
  };

  const getCustomOrderedTools = () => {
    const allTools = ToolRegistry.getAllTools();
    const toolMap = new Map(allTools.map(t => [t.name, t]));
    const result: any[] = [];
    for (const name of customToolNames) {
      const tool = toolMap.get(name);
      if (tool) result.push(tool);
    }
    return result;
  };

  // ── Tab Header ──
  const header = document.createElement('div');
  header.className = 'ai-panel__header';

  const allTab = document.createElement('button');
  allTab.className = 'ai-panel__tab' + (activeTab === 'all' ? ' ai-panel__tab--active' : '');
  const allTabLabel = document.createElement('span');
  allTabLabel.textContent = 'All Tools';
  allTab.appendChild(allTabLabel);
  const allTabBadge = document.createElement('span');
  allTabBadge.className = 'ai-panel__tab-badge';
  allTab.appendChild(allTabBadge);

  const customTab = document.createElement('button');
  customTab.className = 'ai-panel__tab' + (activeTab === 'custom' ? ' ai-panel__tab--active' : '');
  const customTabLabel = document.createElement('span');
  customTabLabel.textContent = 'Custom';
  customTab.appendChild(customTabLabel);
  const customTabBadge = document.createElement('span');
  customTabBadge.className = 'ai-panel__tab-badge';
  customTab.appendChild(customTabBadge);

  header.appendChild(customTab);
  header.appendChild(allTab);
  aside.appendChild(header);

  // ── Views Container ──
  const viewsContainer = document.createElement('div');
  viewsContainer.className = 'ai-panel__views';
  viewsContainer.style.display = 'flex';
  viewsContainer.style.flexDirection = 'column';
  viewsContainer.style.flex = '1';
  viewsContainer.style.overflow = 'hidden';
  viewsContainer.style.position = 'relative';

  const allToolsView = document.createElement('div');
  allToolsView.className = 'ai-panel__view';
  allToolsView.style.display = activeTab === 'all' ? 'flex' : 'none';
  allToolsView.style.flexDirection = 'column';
  allToolsView.style.padding = '16px';
  allToolsView.style.gap = '8px';
  allToolsView.style.overflowY = 'auto';
  allToolsView.style.flex = '1';

  const customToolsView = document.createElement('div');
  customToolsView.className = 'ai-panel__view';
  customToolsView.style.display = activeTab === 'custom' ? 'flex' : 'none';
  customToolsView.style.flexDirection = 'column';
  customToolsView.style.padding = '16px';
  customToolsView.style.gap = '8px';
  customToolsView.style.overflowY = 'auto';
  customToolsView.style.flex = '1';

  viewsContainer.appendChild(allToolsView);
  viewsContainer.appendChild(customToolsView);
  aside.appendChild(viewsContainer);

  const toolSettingsSidebar = createToolSettingsSidebar();
  document.body.appendChild(toolSettingsSidebar.overlay);

  const switchTab = (tab: 'all' | 'custom') => {
    activeTab = tab;
    localStorage.setItem('aiPanelActiveTab', tab);
    if (tab === 'all') {
      allTab.classList.add('ai-panel__tab--active');
      customTab.classList.remove('ai-panel__tab--active');
      allToolsView.style.display = 'flex';
      customToolsView.style.display = 'none';
    } else {
      customTab.classList.add('ai-panel__tab--active');
      allTab.classList.remove('ai-panel__tab--active');
      customToolsView.style.display = 'flex';
      allToolsView.style.display = 'none';
    }
  };

  allTab.addEventListener('click', () => switchTab('all'));
  customTab.addEventListener('click', () => switchTab('custom'));

  function createToolRow(tool: any, mode: 'all' | 'custom') {
    const isPinned = customToolNames.includes(tool.name);

    const toolRow = document.createElement('div');
    toolRow.className = 'ai-tool-row';
    toolRow.draggable = true;
    toolRow.dataset.toolName = tool.name;

    const btn = document.createElement('button');
    btn.className = 'ai-tool-btn';

    if (tool.icon) {
      btn.appendChild(icon(tool.icon, 16));
    } else {
      const spacer = document.createElement('span');
      spacer.style.width = '16px';
      spacer.style.display = 'inline-block';
      btn.appendChild(spacer);
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'ai-tool-name';
    nameSpan.textContent = tool.name;
    btn.appendChild(nameSpan);

    btn.addEventListener('click', async () => {
      btn.style.transform = 'scale(0.97)';
      setTimeout(() => btn.style.transform = '', 120);

      const createContext = () => {
        const docManager = DocumentManager.getInstance();
        const context: ToolContext = {
          image: docManager.getCurrentCanvas(),
          psd: docManager.getCurrentPsd(),
          selectedLayer: null,
          getSelectedImage: async () => {
            const current = docManager.getCurrentCanvas();
            if (!current) return null;
            const canvas = document.createElement('canvas');
            canvas.width = current.width;
            canvas.height = current.height;
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.drawImage(current, 0, 0);
            return canvas;
          },
          getCompositeImage: async () => {
            const current = docManager.getCurrentCanvas();
            if (!current) return null;
            const canvas = document.createElement('canvas');
            canvas.width = current.width;
            canvas.height = current.height;
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.drawImage(current, 0, 0);
            return canvas;
          },
          getPrompts: (toolName?: string) => {
            let pos = '';
            if (toolName) {
              pos = getGlobalSetting(`toolPrompt_${toolName}`, '');
            }
            return { prompt: pos };
          },
        };
        return context;
      };

      const executeTool = async () => {
        const context = createContext();
        try {
          window.dispatchEvent(new CustomEvent('tool:start', { detail: { toolName: tool.name } }));
          await tool.execute(context);
          showToast(`${tool.name} completed.`, 'success');
          toolSettingsSidebar.close();
        } catch (err: any) {
          if (err.name === 'AbortError' || err.message === 'AbortError') {
            return;
          }
          console.error(err);
          showToast(`${tool.name} failed: ${err.message || 'Unknown error'}`, 'error');

          if (!err.archiveSaved) {
            try {
              const docManager = DocumentManager.getInstance();
              let targetFolder = docManager.getCurrentArchiveFolder();
              
              const date = new Date();
              const formattedTime = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
              const errorMessage = `[${formattedTime}] (${tool.name}): ${err.message || 'Unknown error'}\n`;

              if (targetFolder) {
                await appendArchiveLog(targetFolder, errorMessage, 'error.txt');
              } else {
                targetFolder = `${formattedTime}_${tool.name}_error`;
                const errorBlob = new Blob([errorMessage], { type: 'text/plain' });
                await saveArchive(targetFolder, [{ blob: errorBlob, path: 'error.txt' }]);
              }
              window.dispatchEvent(new Event('tool:cache-updated'));
            } catch (cacheErr) {
              console.error('Failed to save error cache:', cacheErr);
            }
          }
        } finally {
          window.dispatchEvent(new Event('tool:end'));
        }
      };

      const executeColoringTool = async () => {
        const context = createContext();
        if ('executeColoring' in tool && typeof (tool as any).executeColoring === 'function') {
          try {
            window.dispatchEvent(new CustomEvent('tool:start', { detail: { toolName: `${tool.name} (Coloring)` } }));
            await (tool as any).executeColoring(context);
          } catch (err: any) {
            console.error(err);
            showToast(`${tool.name} coloring setup failed: ${err.message || 'Unknown error'}`, 'error');

            if (!err.archiveSaved) {
              try {
                const date = new Date();
                const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
                const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
                const folderName = `${dateStr}_${timeStr}_${tool.name}_Coloring_error`;
                const errorText = `${tool.name} (Coloring) Execution Error\n\nDate: ${date.toLocaleString()}\nError: ${err.message || 'Unknown error'}\nStack: ${err.stack || ''}`;
                const errorBlob = new Blob([errorText], { type: 'text/plain' });

                await saveArchive(folderName, [{ blob: errorBlob, path: 'error.txt' }]);
                window.dispatchEvent(new Event('tool:cache-updated'));
              } catch (cacheErr) {
                console.error('Failed to save error cache:', cacheErr);
              }
            }
          } finally {
            window.dispatchEvent(new Event('tool:end'));
          }
        } else {
          showToast('このツールには着彩機能がありません。', 'error');
        }
      };

      if (tool.renderSettings) {
        const hasColoring = 'executeColoring' in tool && typeof (tool as any).executeColoring === 'function';
        toolSettingsSidebar.open(
          tool.name,
          tool.renderSettings.bind(tool),
          executeTool,
          hasColoring ? executeColoringTool : undefined,
          tool.executeLabel,
          tool.executeIcon
        );
      } else {
        await executeTool();
      }
    });

    toolRow.appendChild(btn);

    const actionBtn = document.createElement('button');
    actionBtn.className = 'ai-tool-action-btn';

    if (mode === 'all') {
      actionBtn.title = isPinned ? 'Customから除外' : 'Customに追加 (ピン留め)';
      if (isPinned) {
        actionBtn.classList.add('ai-tool-action-btn--pinned');
      }
      actionBtn.appendChild(icon('push_pin', 16));

      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleToolCustom(tool.name);
      });
    } else {
      actionBtn.title = 'Customから除外';
      actionBtn.classList.add('ai-tool-action-btn--remove');
      actionBtn.appendChild(icon('close', 16));

      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeToolFromCustom(tool.name);
      });
    }

    toolRow.appendChild(actionBtn);
    return toolRow;
  }

  function setupDragAndDrop(container: HTMLElement, storageKey: string, onOrderSaved?: (order: string[]) => void) {
    let draggedItem: HTMLElement | null = null;

    container.addEventListener('dragstart', (e) => {
      const target = (e.target as HTMLElement).closest('.ai-tool-row') as HTMLElement;
      if (!target) return;
      draggedItem = target;
      setTimeout(() => {
        if (draggedItem) draggedItem.style.opacity = '0.5';
      }, 0);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', target.dataset.toolName || '');
      }
    });

    container.addEventListener('dragend', () => {
      setTimeout(() => {
        if (draggedItem) {
          draggedItem.style.opacity = '1';
        }
        draggedItem = null;
        Array.from(container.children).forEach(child => {
          (child as HTMLElement).style.borderTop = '';
          (child as HTMLElement).style.borderBottom = '';
          (child as HTMLElement).style.transform = '';
        });
      }, 0);
    });

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

      const target = (e.target as HTMLElement).closest('.ai-tool-row') as HTMLElement;
      if (target && draggedItem && draggedItem !== target && container.contains(target)) {
        const bounding = target.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);

        target.style.borderTop = '';
        target.style.borderBottom = '';
        target.style.transform = '';

        if (e.clientY > offset) {
          target.style.borderBottom = '2px solid var(--color-primary)';
          target.style.transform = 'translateY(-1px)';
        } else {
          target.style.borderTop = '2px solid var(--color-primary)';
          target.style.transform = 'translateY(1px)';
        }
      }
    });

    container.addEventListener('dragleave', (e) => {
      const target = (e.target as HTMLElement).closest('.ai-tool-row') as HTMLElement;
      if (target) {
        const rect = target.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
          target.style.borderTop = '';
          target.style.borderBottom = '';
          target.style.transform = '';
        }
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      Array.from(container.children).forEach(child => {
        (child as HTMLElement).style.borderTop = '';
        (child as HTMLElement).style.borderBottom = '';
        (child as HTMLElement).style.transform = '';
      });

      const target = (e.target as HTMLElement).closest('.ai-tool-row') as HTMLElement;
      if (draggedItem && target && draggedItem !== target && container.contains(target)) {
        const bounding = target.getBoundingClientRect();
        const offset = bounding.y + (bounding.height / 2);

        if (e.clientY > offset) {
          target.after(draggedItem);
        } else {
          target.before(draggedItem);
        }

        const newOrder = Array.from(container.querySelectorAll('.ai-tool-row'))
          .map(child => (child as HTMLElement).dataset?.toolName)
          .filter(Boolean) as string[];
        localStorage.setItem(storageKey, JSON.stringify(newOrder));
        if (onOrderSaved) onOrderSaved(newOrder);
      } else if (draggedItem && (e.target === container || (e.target as HTMLElement).classList.contains('ai-panel__view'))) {
        container.appendChild(draggedItem);
        const newOrder = Array.from(container.querySelectorAll('.ai-tool-row'))
          .map(child => (child as HTMLElement).dataset?.toolName)
          .filter(Boolean) as string[];
        localStorage.setItem(storageKey, JSON.stringify(newOrder));
        if (onOrderSaved) onOrderSaved(newOrder);
      }
    });
  }

  const renderCustomView = () => {
    customToolsView.innerHTML = '';

    const customTools = getCustomOrderedTools();
    customTabBadge.textContent = String(customTools.length);

    if (customTools.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'ai-panel__empty';

      const emptyText = document.createElement('div');
      emptyText.className = 'ai-panel__empty-text';
      emptyText.textContent = 'カスタムツールが登録されていません。「All Tools」タブのピン留めアイコンをクリックしてツールを追加してください。';
      emptyDiv.appendChild(emptyText);

      customToolsView.appendChild(emptyDiv);
      return;
    }

    for (const tool of customTools) {
      const row = createToolRow(tool, 'custom');
      customToolsView.appendChild(row);
    }
  };

  const renderAllView = () => {
    allToolsView.innerHTML = '';
    const tools = getAllOrderedTools();
    allTabBadge.textContent = String(tools.length);

    for (const tool of tools) {
      const row = createToolRow(tool, 'all');
      allToolsView.appendChild(row);
    }
  };

  const toggleToolCustom = (toolName: string) => {
    if (customToolNames.includes(toolName)) {
      removeToolFromCustom(toolName);
    } else {
      addToolToCustom(toolName);
    }
  };

  const addToolToCustom = (toolName: string) => {
    if (!customToolNames.includes(toolName)) {
      customToolNames.push(toolName);
      localStorage.setItem('customToolOrder', JSON.stringify(customToolNames));
      renderAllView();
      renderCustomView();
      showToast(`${toolName} をCustomに追加しました。`, 'success');
    }
  };

  const removeToolFromCustom = (toolName: string) => {
    const idx = customToolNames.indexOf(toolName);
    if (idx !== -1) {
      customToolNames.splice(idx, 1);
      localStorage.setItem('customToolOrder', JSON.stringify(customToolNames));
      renderAllView();
      renderCustomView();
      showToast(`${toolName} をCustomから除外しました。`, 'info');
    }
  };

  setupDragAndDrop(allToolsView, 'toolOrder');
  setupDragAndDrop(customToolsView, 'customToolOrder', (newOrder) => {
    customToolNames = newOrder;
  });

  renderAllView();
  renderCustomView();

  return aside;
}

