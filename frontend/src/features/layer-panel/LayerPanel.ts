/**
 * LayerPanel — Left sidebar with layer tree and layer properties inspector.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';
import type { Psd, Layer } from 'ag-psd';
import { getArchives, deleteArchive, extractArchiveFile, updateArchiveFolderCollapse, getArchiveCollapseState } from '../../shared/utils/archives';
import { CachedImage } from '../../shared/utils/idb';
import { historyManager } from '../../shared/utils/history';

interface LayerDef {
  name: string;
  iconName: string;
  isGroup?: boolean;
  isChild?: boolean;
  depth?: number;
  active?: boolean;
  badge?: string;
  spaced?: boolean;
  hidden?: boolean;
  collapsed?: boolean;
  layer?: Layer;
  isRoot?: boolean;
  _utId?: string;
}

export let globalIsOverlayMode = false;

window.addEventListener('overlay-mode:toggle', (e: Event) => {
  globalIsOverlayMode = (e as CustomEvent).detail.enabled;
  window.dispatchEvent(new Event('overlay-mode:changed'));
  window.dispatchEvent(new Event('document:redraw'));
});

interface CacheDef {
  item: CachedImage;
  depth: number;
  isChild: boolean;
  isGroup: boolean;
  collapsed: boolean;
  active: boolean;
}

const layers: LayerDef[] = [];

export interface LayerPanelOptions {
  panelType?: 'left' | 'right';
  isCompareMode?: boolean;
  initialState?: {
    layerDefs: any[];
    activeCacheIndices: number[];
    lastCacheIndex: number | null;
    psd: any;
  };
}

export function createLayerPanel(options: LayerPanelOptions = {}): HTMLElement {
  let currentLayerDefs: LayerDef[] = options.initialState 
    ? options.initialState.layerDefs.map((l: any) => ({...l})) 
    : [...layers];

  let uLayerId: string | null = null;
  let tLayerId: string | null = null;
  let uLayerObj: any = null;
  let tLayerObj: any = null;
  let uCacheKey: string | null = null;
  let tCacheKey: string | null = null;

  const overlayUEvent = options.panelType === 'right' ? 'overlay:select-u:right' : 'overlay:select-u';
  const overlayTEvent = options.panelType === 'right' ? 'overlay:select-t:right' : 'overlay:select-t';

  window.addEventListener(overlayUEvent, (e: Event) => {
    const d = (e as CustomEvent).detail;
    uLayerId = d.id;
    uLayerObj = d.layer;
    uCacheKey = d.cacheKey;
    window.dispatchEvent(new Event('overlay-mode:changed'));
    window.dispatchEvent(new Event('document:redraw'));
  });

  window.addEventListener(overlayTEvent, (e: Event) => {
    const d = (e as CustomEvent).detail;
    tLayerId = d.id;
    tLayerObj = d.layer;
    tCacheKey = d.cacheKey;
    window.dispatchEvent(new Event('overlay-mode:changed'));
    window.dispatchEvent(new Event('document:redraw'));
  });

  function createUTBoxes(id: string, layerObj: any, cacheKey: string | null) {
    const container = document.createElement('div');
    container.className = 'layer-item__ut-boxes';
    container.style.display = globalIsOverlayMode ? 'flex' : 'none';
    container.style.gap = '4px';
    container.style.marginLeft = 'auto';
    container.style.marginRight = '8px';
    
    const uBox = document.createElement('div');
    const tBox = document.createElement('div');
    
    const updateBox = (box: HTMLDivElement, label: 'U' | 'T', isSelected: boolean) => {
      box.textContent = label;
      box.style.width = '14px';
      box.style.height = '14px';
      box.style.display = 'flex';
      box.style.alignItems = 'center';
      box.style.justifyContent = 'center';
      box.style.border = '1px solid var(--color-on-surface-variant)';
      box.style.borderRadius = '2px';
      box.style.cursor = 'pointer';
      box.style.fontSize = '10px';
      box.style.fontWeight = 'bold';
      box.style.color = isSelected ? 'var(--color-on-surface)' : 'transparent';
      box.style.backgroundColor = 'transparent';
    };

    const sync = () => {
      container.style.display = globalIsOverlayMode ? 'flex' : 'none';
      updateBox(uBox, 'U', uLayerId === id);
      updateBox(tBox, 'T', tLayerId === id);
    };
    sync();
    
    uBox.addEventListener('click', (e) => {
      e.stopPropagation();
      const isSelected = uLayerId === id;
      const detail = isSelected ? { id: null, layer: null, cacheKey: null } : { id, layer: layerObj, cacheKey };
      window.dispatchEvent(new CustomEvent(overlayUEvent, { detail }));
    });
    tBox.addEventListener('click', (e) => {
      e.stopPropagation();
      const isSelected = tLayerId === id;
      const detail = isSelected ? { id: null, layer: null, cacheKey: null } : { id, layer: layerObj, cacheKey };
      window.dispatchEvent(new CustomEvent(overlayTEvent, { detail }));
    });
    
    container.appendChild(uBox);
    container.appendChild(tBox);
    
    const listener = () => sync();
    window.addEventListener('overlay-mode:changed', listener);
    
    return container;
  }



  const aside = document.createElement('aside');
  aside.className = options.panelType === 'right' ? 'layer-panel layer-panel--right' : 'layer-panel';
  
  // ── Resizer ──
  const resizer = document.createElement('div');
  resizer.className = options.panelType === 'right' ? 'ai-panel__resizer' : 'layer-panel__resizer';
  
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = aside.getBoundingClientRect().width;
    document.body.style.cursor = 'ew-resize';
    e.preventDefault(); // Prevent text selection
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    let newWidth;
    if (options.panelType === 'right') {
      newWidth = startWidth - (e.clientX - startX);
    } else {
      newWidth = startWidth + (e.clientX - startX);
    }
    // Add constraints
    if (newWidth > 150 && newWidth < 600) {
      if (options.panelType === 'right') {
        document.documentElement.style.setProperty('--right-sidebar-width', `${newWidth}px`);
      } else {
        document.documentElement.style.setProperty('--left-sidebar-width', `${newWidth}px`);
      }
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
    }
  });

  aside.appendChild(resizer);

  const dispatchVisibilityChange = (items: LayerDef[]) => {
    const hiddenLayers = new Set<any>();
    items.forEach(l => {
      if (l.hidden && l.layer) hiddenLayers.add(l.layer);
      // Keep PSD global state in sync with left panel only
      if (options.panelType !== 'right' && l.layer) {
        l.layer.hidden = l.hidden;
      }
    });
    const eventName = options.panelType === 'right' ? 'layer:visibility:right' : 'layer:visibility';
    window.dispatchEvent(new CustomEvent(eventName, { detail: { hiddenLayers } }));
  };

  const cloneState = (state: LayerDef[]): LayerDef[] => {
    return state.map(l => ({ ...l }));
  };

  const commitStateChange = async (label: string, mutator: () => void | Promise<void>) => {
    const beforeState = cloneState(currentLayerDefs);
    await mutator();
    const afterState = cloneState(currentLayerDefs);

    const restoreFn = (state: LayerDef[]) => {
      currentLayerDefs = cloneState(state);
      if (currentPsd) currentPsd.children = rebuildPsdHierarchy(currentLayerDefs);
      renderLayerTree(currentLayerDefs);
      dispatchVisibilityChange(currentLayerDefs);
      window.dispatchEvent(new Event('document:redraw'));
    };

    historyManager.push({
      label,
      execute: () => restoreFn(afterState),
      undo: () => restoreFn(beforeState)
    });
  };

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'layer-panel__header';

  const title = document.createElement('span');
  title.className = 'layer-panel__title';
  title.textContent = 'LAYER TREE';
  header.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'layer-panel__actions';
  const addImageBtn = document.createElement('button');
  addImageBtn.className = 'layer-panel__action-btn';
  addImageBtn.title = '画像を追加';
  addImageBtn.appendChild(icon('add', 16));
  
  window.addEventListener('compare-mode:toggle', (e: Event) => {
    const enabled = (e as CustomEvent).detail.enabled;
    addImageBtn.disabled = enabled;
    if (enabled) {
      addImageBtn.style.opacity = '0.5';
      addImageBtn.style.cursor = 'not-allowed';
    } else {
      addImageBtn.style.opacity = '';
      addImageBtn.style.cursor = '';
    }
  });
  
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  
  fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    
    try {
      if (!currentPsd) {
        showToast('PSDが開かれていません', false);
        return;
      }
      
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(bmp, 0, 0);

      await commitStateChange(`画像追加: ${file.name}`, async () => {
        let activeIndex = currentLayerDefs.findIndex(l => l.active);
        let baseInsertIndex = 1;
        let insertDepth = 1;

        if (activeIndex !== -1) {
          const activeLayer = currentLayerDefs[activeIndex];
          if (activeLayer.isGroup) {
            insertDepth = (activeLayer.depth || 0) + 1;
            baseInsertIndex = activeIndex + 1;
            activeLayer.collapsed = false;
          } else {
            insertDepth = activeLayer.depth || 1;
            baseInsertIndex = activeIndex;
          }
        }

        // Prevent inserting before root
        if (baseInsertIndex <= 0) baseInsertIndex = 1;

        currentLayerDefs.forEach(l => l.active = false);

        const newLayer: Layer = {
          name: file.name,
          canvas: canvas,
          hidden: false,
          opacity: 255,
          blendMode: 'normal'
        };

        const newDef: LayerDef = {
          name: file.name,
          iconName: 'image',
          isGroup: false,
          isChild: insertDepth > 0,
          depth: insertDepth,
          active: true,
          layer: newLayer
        };

        currentLayerDefs.splice(baseInsertIndex, 0, newDef);
        
        if (currentPsd) {
          currentPsd.children = rebuildPsdHierarchy(currentLayerDefs);
        }
        renderLayerTree(currentLayerDefs);
        dispatchVisibilityChange(currentLayerDefs);
        window.dispatchEvent(new Event('document:redraw'));
      });
      showToast(`「${file.name}」を追加しました`, 'success');
    } catch (err) {
      console.error(err);
      showToast('画像の追加に失敗しました', 'error');
    }
    
    fileInput.value = '';
  });
  
  addImageBtn.addEventListener('click', () => {
    fileInput.click();
  });
  
  actions.appendChild(addImageBtn);
  actions.appendChild(fileInput);

  const createGroupBtn = document.createElement('button');
  createGroupBtn.className = 'layer-panel__action-btn';
  createGroupBtn.title = 'フォルダ作成';
  createGroupBtn.appendChild(icon('create_new_folder', 16));
  createGroupBtn.addEventListener('click', () => {
    commitStateChange('フォルダ作成', () => {
      const activeIndex = currentLayerDefs.findIndex(l => l.active);
      let baseInsertIndex = 0;
      let insertDepth = 1;

      if (activeIndex !== -1) {
        const activeDef = currentLayerDefs[activeIndex];
        if (activeDef.isRoot) {
          baseInsertIndex = activeIndex + 1;
          insertDepth = 1;
        } else if (activeDef.isGroup) {
          baseInsertIndex = activeIndex + 1;
          insertDepth = (activeDef.depth || 0) + 1;
        } else {
          baseInsertIndex = activeIndex;
          insertDepth = activeDef.depth || 0;
        }
      } else {
        baseInsertIndex = currentLayerDefs.length;
        if (currentLayerDefs.length > 0 && currentLayerDefs[0].isRoot) {
          insertDepth = 1;
        } else {
          insertDepth = 0;
        }
      }

      const newGroupDef: LayerDef = {
        name: 'New Folder',
        iconName: 'folder',
        isGroup: true,
        isChild: insertDepth > 0,
        depth: insertDepth,
        active: true,
        layer: { name: 'New Folder', children: [] }
      };

      currentLayerDefs.forEach(l => l.active = false);
      currentLayerDefs.splice(baseInsertIndex, 0, newGroupDef);

      if (currentPsd) {
        currentPsd.children = rebuildPsdHierarchy(currentLayerDefs);
      }
      
      renderLayerTree(currentLayerDefs);
      window.dispatchEvent(new Event('document:redraw'));
    });
  });
  actions.appendChild(createGroupBtn);

  const deleteLayerBtn = document.createElement('button');
  deleteLayerBtn.className = 'layer-panel__action-btn';
  deleteLayerBtn.title = 'レイヤー削除';
  deleteLayerBtn.appendChild(icon('delete', 16));
  deleteLayerBtn.addEventListener('click', () => {
    const activeIndex = currentLayerDefs.findIndex(l => l.active);
    if (activeIndex === -1) {
      showToast('削除するレイヤーを選択してください', false);
      return;
    }

    const activeLayer = currentLayerDefs[activeIndex];
    if (activeLayer.isRoot) {
      showToast('PSDファイル自体は削除できません', false);
      return;
    }

    commitStateChange(`レイヤー削除: ${activeLayer.name}`, () => {
      let deleteCount = 1;

      if (activeLayer.isGroup) {
        const groupDepth = activeLayer.depth || 0;
        for (let i = activeIndex + 1; i < currentLayerDefs.length; i++) {
          if ((currentLayerDefs[i].depth || 0) > groupDepth) {
            deleteCount++;
          } else {
            break;
          }
        }
      }

      currentLayerDefs.splice(activeIndex, deleteCount);

      if (currentPsd) {
        currentPsd.children = rebuildPsdHierarchy(currentLayerDefs);
      }

      renderLayerTree(currentLayerDefs);
      window.dispatchEvent(new Event('document:redraw'));
    });
    showToast(`「${activeLayer.name}」を削除しました`, 'success');
  });
  actions.appendChild(deleteLayerBtn);

  header.appendChild(actions);
  aside.appendChild(header);

  // ── Layer Tree ──
  const tree = document.createElement('div');
  tree.className = 'layer-tree';

  let draggedIndex: number | null = null;

  const renderLayerTree = (items: LayerDef[]) => {
    tree.innerHTML = '';
    let skipDepth = -1;
    let activeGroupDepth = -1;

    for (let i = 0; i < items.length; i++) {
      const layerDef = items[i];
      const currentDepth = layerDef.depth || 0;

      if (skipDepth !== -1) {
        if (currentDepth > skipDepth) {
          continue;
        } else {
          skipDepth = -1;
        }
      }

      if (layerDef.isGroup && layerDef.collapsed && skipDepth === -1) {
        skipDepth = currentDepth;
      }

      let inActiveGroup = false;
      if (activeGroupDepth !== -1) {
        if (currentDepth > activeGroupDepth) {
          inActiveGroup = true;
        } else {
          activeGroupDepth = -1;
        }
      }
      if (layerDef.active && layerDef.isGroup) {
        activeGroupDepth = currentDepth;
      }

      const item = document.createElement('div');
      item.dataset.index = i.toString();
      const classes = ['layer-item'];
      if (layerDef.active) classes.push('layer-item--active');
      if (layerDef.isGroup) classes.push('layer-item--group');
      if (layerDef.isChild) classes.push('layer-item--child');
      if (layerDef.spaced) classes.push('layer-item--spaced');
      if (layerDef.hidden) classes.push('layer-item--hidden');
      item.className = classes.join(' ');
      
      const indent = currentDepth * 16;
      item.style.paddingLeft = `${8 + indent}px`;
      
      if (inActiveGroup && !layerDef.active) {
        item.style.backgroundColor = 'var(--color-surface-container-high)';
      }

      // Click to select
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return; // Don't trigger when clicking input

        const wasActive = layerDef.active;
        items.forEach((l) => (l.active = false));
        layerDef.active = !wasActive;
        
        // Instead of full re-render, update DOM states manually to allow dblclick to fire
        const allItems = tree.querySelectorAll('.layer-item:not(.layer-item--drop-zone)');
        let activeGroupDepth = -1;
        
        allItems.forEach((el) => {
          const htmlEl = el as HTMLElement;
          const originalIndex = parseInt(htmlEl.dataset.index || '-1', 10);
          if (originalIndex === -1) return;
          const lDef = items[originalIndex];
          if (!lDef) return;

          let inActiveGroup = false;
          const currentDepth = lDef.depth || 0;
          if (activeGroupDepth !== -1) {
            if (currentDepth > activeGroupDepth) {
              inActiveGroup = true;
            } else {
              activeGroupDepth = -1;
            }
          }
          if (lDef.active && lDef.isGroup) {
            activeGroupDepth = currentDepth;
          }

          if (lDef.active) {
            el.classList.add('layer-item--active');
            htmlEl.style.backgroundColor = '';
            const nameSpan = el.querySelector('.layer-item__name') as HTMLElement;
            if (nameSpan) nameSpan.style.color = 'var(--color-on-surface)';
            const typeIcon = el.querySelector('.layer-item__icon--type');
            if (typeIcon) {
              typeIcon.classList.remove('layer-item__icon--type');
              typeIcon.classList.add('layer-item__icon--type-active');
            }
          } else {
            el.classList.remove('layer-item--active');
            htmlEl.style.backgroundColor = inActiveGroup ? 'var(--color-surface-container-high)' : '';
            const nameSpan = el.querySelector('.layer-item__name') as HTMLElement;
            if (nameSpan) nameSpan.style.color = '';
            const typeIconActive = el.querySelector('.layer-item__icon--type-active');
            if (typeIconActive) {
              typeIconActive.classList.remove('layer-item__icon--type-active');
              typeIconActive.classList.add('layer-item__icon--type');
            }
          }
        });
        
        const eventName = options.panelType === 'right' ? 'layer:selected:right' : 'layer:selected';
        window.dispatchEvent(new CustomEvent(eventName, {
          detail: { layer: layerDef.active ? layerDef.layer : null }
        }));
      });

      // Drag and drop
      item.draggable = true;

      item.addEventListener('dragstart', (e) => {
        if (layerDef.isRoot) {
          e.preventDefault();
          return;
        }
        draggedIndex = i;
        item.classList.add('layer-item--dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', i.toString());
        }
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('layer-item--dragging');
        draggedIndex = null;
        const allItems = tree.querySelectorAll('.layer-item');
        allItems.forEach(el => {
          el.classList.remove('layer-item--drag-over');
          (el as HTMLElement).style.boxShadow = '';
        });
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault(); // Necessary to allow dropping
        if (draggedIndex !== null && draggedIndex !== i) {
          const draggedItem = items[draggedIndex];
          let isChildOfDragged = false;
          if (draggedItem.isGroup) {
            const draggedDepth = draggedItem.depth || 0;
            for (let j = draggedIndex + 1; j <= i; j++) {
              if ((items[j].depth || 0) <= draggedDepth) {
                break;
              }
              if (j === i) isChildOfDragged = true;
            }
          }

          if (!isChildOfDragged) {
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            
            item.classList.remove('layer-item--drag-over');
            item.style.boxShadow = '';

            const rect = item.getBoundingClientRect();
            const y = e.clientY - rect.top;
            
            if (layerDef.isGroup) {
              if (y < rect.height * 0.25) {
                item.style.boxShadow = 'inset 0 2px 0 var(--color-primary)';
              } else if (y > rect.height * 0.75) {
                item.style.boxShadow = 'inset 0 -2px 0 var(--color-primary)';
              } else {
                item.style.boxShadow = 'inset 0 0 0 2px var(--color-primary)';
              }
            } else {
              if (y < rect.height / 2) {
                item.style.boxShadow = 'inset 0 2px 0 var(--color-primary)';
              } else {
                item.style.boxShadow = 'inset 0 -2px 0 var(--color-primary)';
              }
            }
          }
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('layer-item--drag-over');
        item.style.boxShadow = '';
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('layer-item--drag-over');
        item.style.boxShadow = '';
        
        if (draggedIndex !== null && draggedIndex !== i) {
          const idx = draggedIndex;
          commitStateChange('レイヤー移動', () => {
            const draggedItem = items[idx];
            const draggedDepth = draggedItem.depth || 0;
            let draggedCount = 1;

            if (draggedItem.isGroup) {
              for (let j = idx + 1; j < items.length; j++) {
                if ((items[j].depth || 0) > draggedDepth) {
                  draggedCount++;
                } else {
                  break;
                }
              }
            }

            if (i >= idx && i < idx + draggedCount) {
              return; // Dropping inside itself
            }

            const rect = item.getBoundingClientRect();
            const y = e.clientY - rect.top;
            let position = 'before';

            if (layerDef.isGroup) {
              if (y < rect.height * 0.25) position = 'before';
              else if (y > rect.height * 0.75) position = 'after';
              else position = 'inside';
            } else {
              if (y < rect.height / 2) position = 'before';
              else position = 'after';
            }

            const movingItems = items.splice(idx, draggedCount);
            let insertIndex = i;
            if (idx < i) {
              insertIndex -= draggedCount;
            }

            const targetItem = items[insertIndex];
            const targetDepth = targetItem ? (targetItem.depth || 0) : 0;
            let newDepth = targetDepth;
            let finalInsertIndex = insertIndex;

            if (targetItem && targetItem.isRoot && position !== 'inside') {
              position = 'inside';
            }
            if (insertIndex === 0 && position === 'before') {
              position = 'inside';
            }

            if (position === 'inside') {
              newDepth = targetDepth + 1;
              finalInsertIndex = insertIndex + 1;
              targetItem.collapsed = false; // Expand folder automatically
            } else if (position === 'after') {
              let skipCount = 1;
              if (targetItem.isGroup) {
                for (let j = insertIndex + 1; j < items.length; j++) {
                  if ((items[j].depth || 0) > targetDepth) skipCount++;
                  else break;
                }
              }
              finalInsertIndex = insertIndex + skipCount;
              newDepth = targetDepth;
            } else {
              finalInsertIndex = insertIndex;
              newDepth = targetDepth;
            }

            const depthDiff = newDepth - draggedDepth;
            if (depthDiff !== 0) {
              for (const movingItem of movingItems) {
                movingItem.depth = (movingItem.depth || 0) + depthDiff;
                movingItem.isChild = (movingItem.depth > 0);
              }
            }

            items.splice(finalInsertIndex, 0, ...movingItems);
            
            if (currentPsd) {
              currentPsd.children = rebuildPsdHierarchy(items);
            }

            renderLayerTree(items);
            window.dispatchEvent(new Event('document:redraw'));
          });
        }
      });

      // Visibility Checkbox
      const visBox = document.createElement('div');
      visBox.className = 'layer-item__vis-box';
      visBox.style.width = '14px';
      visBox.style.height = '14px';
      visBox.style.border = '1px solid var(--color-on-surface-variant)';
      visBox.style.borderRadius = '2px';
      visBox.style.display = 'flex';
      visBox.style.alignItems = 'center';
      visBox.style.justifyContent = 'center';
      visBox.style.marginRight = '8px';
      visBox.style.cursor = 'pointer';
      visBox.style.flexShrink = '0';
      
      const syncVisBox = () => {
        visBox.style.visibility = globalIsOverlayMode ? 'hidden' : 'visible';
      };
      syncVisBox();
      window.addEventListener('overlay-mode:changed', syncVisBox);

      let visState = 'hidden'; // 'visible', 'hidden', 'partial'
      
      if (!layerDef.isGroup) {
        visState = layerDef.hidden ? 'hidden' : 'visible';
      } else {
        const groupDepth = layerDef.depth || 0;
        let visibleCount = 0;
        let childCount = 0;
        for (let j = i + 1; j < items.length; j++) {
          const child = items[j];
          if ((child.depth || 0) <= groupDepth) break;
          childCount++;
          if (!child.hidden) visibleCount++;
        }
        if (childCount === 0) {
          visState = layerDef.hidden ? 'hidden' : 'visible';
        } else if (visibleCount === 0) {
          visState = 'hidden';
        } else if (visibleCount === childCount) {
          visState = 'visible';
        } else {
          visState = 'partial';
        }
      }

      if (visState === 'visible') {
        const dot = document.createElement('div');
        dot.style.width = '8px';
        dot.style.height = '8px';
        dot.style.backgroundColor = 'var(--color-on-surface)';
        dot.style.borderRadius = '50%';
        visBox.appendChild(dot);
      } else if (visState === 'partial') {
        const line = document.createElement('div');
        line.style.width = '8px';
        line.style.height = '2px';
        line.style.backgroundColor = 'var(--color-on-surface)';
        visBox.appendChild(line);
      }

      // Opacity change removed to keep icon color same

      visBox.addEventListener('click', (e) => {
        e.stopPropagation();
        commitStateChange('表示/非表示切替', () => {
          const targetHidden = !layerDef.hidden;
          layerDef.hidden = targetHidden;

          // Toggle children if it's a group
          if (layerDef.isGroup) {
            const targetDepth = layerDef.depth || 0;
            for (let j = i + 1; j < items.length; j++) {
              const childDef = items[j];
              const childDepth = childDef.depth ?? (childDef.isChild ? 1 : 0);
              if (childDepth > targetDepth) {
                childDef.hidden = targetHidden;
              } else {
                break;
              }
            }
          }

          // Update ancestors based on children's state
          let currentItemIndex = i;
          while (true) {
            let parentIndex = -1;
            const currentDepth = items[currentItemIndex].depth || 0;
            if (currentDepth === 0) break; // No parent

            // Find the parent
            for (let k = currentItemIndex - 1; k >= 0; k--) {
              const kDepth = items[k].depth || 0;
              if (kDepth < currentDepth) {
                parentIndex = k;
                break;
              }
            }

            if (parentIndex === -1) break;

            const parentDef = items[parentIndex];
            const pDepth = parentDef.depth || 0;
            
            // Check if any direct child is visible
            let anyChildVisible = false;
            for (let j = parentIndex + 1; j < items.length; j++) {
              const childDef = items[j];
              const cDepth = childDef.depth || 0;
              if (cDepth <= pDepth) break; // End of descendants
               
              if (cDepth === pDepth + 1) {
                if (!childDef.hidden) {
                  anyChildVisible = true;
                  break;
                }
              }
            }

            const shouldHideParent = !anyChildVisible;
            if (!!parentDef.hidden !== shouldHideParent) {
              parentDef.hidden = shouldHideParent;
              currentItemIndex = parentIndex; // Bubble up to parent
            } else {
              break; // Stop bubbling if parent state didn't change
            }
          }

          renderLayerTree(items);
          dispatchVisibilityChange(items);
          window.dispatchEvent(new Event('document:redraw'));
        });
      });

      item.appendChild(visBox);

      // Chevron icon
      if (layerDef.isGroup) {
        const chevronName = layerDef.collapsed ? 'chevron_right' : 'expand_more';
        const chevronIcon = icon(chevronName, 16);
        chevronIcon.className = 'material-symbols-outlined layer-item__icon layer-item__icon--chevron';
        chevronIcon.style.cursor = 'pointer';
        chevronIcon.addEventListener('click', (e) => {
          e.stopPropagation();
          layerDef.collapsed = !layerDef.collapsed;
          renderLayerTree(items);
        });
        item.appendChild(chevronIcon);
      } else {
        const spacer = document.createElement('span');
        spacer.style.width = '16px';
        spacer.style.height = '16px';
        spacer.style.marginRight = '4px';
        spacer.style.display = 'inline-block';
        spacer.style.flexShrink = '0';
        item.appendChild(spacer);
      }

      // Type icon
      let actualIconName = layerDef.iconName;
      if (layerDef.isRoot) {
        actualIconName = 'layers';
      } else if (layerDef.isGroup) {
        actualIconName = layerDef.collapsed ? 'folder' : 'folder_open';
      }
      const typeIcon = icon(actualIconName, 16);
      typeIcon.className = `material-symbols-outlined layer-item__icon ${layerDef.active ? 'layer-item__icon--type-active' : 'layer-item__icon--type'}`;
      item.appendChild(typeIcon);

      // Name
      const name = document.createElement('span');
      name.className = 'layer-item__name';
      name.textContent = layerDef.name;
      name.title = layerDef.name;
      if (layerDef.active) name.style.color = 'var(--color-on-surface)';
      
      name.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (layerDef.isRoot) return;
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = layerDef.name;
        input.className = 'layer-item__name-input';
        
        const saveName = () => {
          commitStateChange('レイヤー名変更', () => {
            layerDef.name = input.value || 'Unnamed Layer';
            if (layerDef.layer) layerDef.layer.name = layerDef.name;
            renderLayerTree(items);
          });
        };
        
        input.addEventListener('blur', saveName);
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') {
            input.blur();
          } else if (ke.key === 'Escape') {
            renderLayerTree(items);
          }
        });
        
        item.replaceChild(input, name);
        input.focus();
        input.select();
      });
      
      item.appendChild(name);

      let isLayerText = false;
      if (!layerDef.isGroup && layerDef.name.match(/\.(json|txt|md)$/i)) {
        isLayerText = true;
      }

      if (!layerDef.isGroup && !isLayerText) {
        if (!layerDef._utId) {
          layerDef._utId = 'psd_' + Math.random().toString(36).substr(2, 9);
        }
        item.appendChild(createUTBoxes(layerDef._utId, layerDef.layer, null));
      }

      // Badge
      if (layerDef.badge) {
        const badge = document.createElement('span');
        badge.className = 'layer-item__badge';
        badge.textContent = layerDef.badge;
        item.appendChild(badge);
      }

      tree.appendChild(item);
    }

    // Add drop zone at the bottom
    const dropZone = document.createElement('div');
    dropZone.className = 'layer-item layer-item--drop-zone';
    dropZone.style.flex = '1';
    dropZone.style.minHeight = '20px';
    dropZone.style.background = 'transparent';
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedIndex !== null) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        dropZone.classList.add('layer-item--drag-over');
      }
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('layer-item--drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('layer-item--drag-over');
      if (draggedIndex !== null) {
        const idx = draggedIndex;
        commitStateChange('レイヤー移動 (末尾)', () => {
          const draggedItem = items[idx];
          const draggedDepth = draggedItem.depth || 0;
          let draggedCount = 1;

          if (draggedItem.isGroup) {
            for (let j = idx + 1; j < items.length; j++) {
              if ((items[j].depth || 0) > draggedDepth) {
                draggedCount++;
              } else {
                break;
              }
            }
          }

          if (idx + draggedCount === items.length) {
            return; // Already at the bottom
          }

          const movingItems = items.splice(idx, draggedCount);
          
          for (const movingItem of movingItems) {
            movingItem.depth = (movingItem.depth || 0) - draggedDepth;
            movingItem.isChild = (movingItem.depth > 0);
          }

          items.push(...movingItems);
          
          if (currentPsd) {
            currentPsd.children = rebuildPsdHierarchy(items);
          }

          renderLayerTree(items);
          window.dispatchEvent(new Event('document:redraw'));
        });
      }
    });
    tree.appendChild(dropZone);
  };

  // Initial render with dummy data
  renderLayerTree(currentLayerDefs);
  if (options.initialState) {
    setTimeout(() => {
      dispatchVisibilityChange(currentLayerDefs);
    }, 0);
  }

  let currentPsd: Psd | null = options.initialState ? options.initialState.psd : null;

  // Listen for PSD loaded event
  window.addEventListener('document:loaded', (e: Event) => {
    const customEvent = e as CustomEvent<{ psd: Psd; filename: string }>;
    const psd = customEvent.detail.psd;
    const filename = customEvent.detail.filename;

    currentPsd = psd;

    if (psd.children) {
      const rootLayerDef: LayerDef = {
        name: filename,
        iconName: 'description',
        isGroup: true,
        depth: 0,
        active: false,
        isRoot: true,
      };
      currentLayerDefs = [rootLayerDef, ...mapPsdLayers(psd.children, 1)];
      renderLayerTree(currentLayerDefs);
      dispatchVisibilityChange(currentLayerDefs);
    }
  });

  window.addEventListener('document:closed', () => {
    currentPsd = null;
    currentLayerDefs = [];
    renderLayerTree(currentLayerDefs);
    dispatchVisibilityChange(currentLayerDefs);
  });
  aside.appendChild(tree);

  // ── CACHE ──
  const cachePanel = document.createElement('div');
  cachePanel.className = 'layer-cache';
  
  const cacheResizer = document.createElement('div');
  cacheResizer.className = 'layer-cache__resizer';
  
  let isCacheResizing = false;
  let cacheStartY = 0;
  let cacheStartHeight = 0;

  cacheResizer.addEventListener('mousedown', (e) => {
    isCacheResizing = true;
    cacheStartY = e.clientY;
    cacheStartHeight = cachePanel.getBoundingClientRect().height;
    document.body.style.cursor = 'ns-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isCacheResizing) return;
    // Dragging UP increases height because resizer is at the top of the panel
    const newHeight = cacheStartHeight - (e.clientY - cacheStartY);
    if (newHeight > 100 && newHeight < 600) {
      document.documentElement.style.setProperty('--cache-panel-height', `${newHeight}px`);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isCacheResizing) {
      isCacheResizing = false;
      document.body.style.cursor = '';
    }
  });
  
  cachePanel.appendChild(cacheResizer);

  const cacheHeader = document.createElement('div');
  cacheHeader.className = 'layer-cache__header';

  const cacheTitle = document.createElement('span');
  cacheTitle.className = 'layer-cache__title';
  cacheTitle.textContent = 'ARCHIVES';
  cacheHeader.appendChild(cacheTitle);

  const promoteBtn = document.createElement('button');
  promoteBtn.className = 'layer-panel__action-btn';
  promoteBtn.title = 'レイヤーに昇格';
  promoteBtn.appendChild(icon('arrow_upward', 16));

  const createFolderBtn = document.createElement('button');
  createFolderBtn.className = 'layer-panel__action-btn';
  createFolderBtn.title = 'フォルダ作成';
  createFolderBtn.appendChild(icon('create_new_folder', 16));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'layer-panel__action-btn';
  deleteBtn.title = 'キャッシュ削除';
  deleteBtn.appendChild(icon('delete', 16));

  let isCompareMode = options.isCompareMode || false;
  const updateButtonsState = () => {
    createGroupBtn.disabled = isCompareMode;
    deleteLayerBtn.disabled = isCompareMode;
    promoteBtn.disabled = isCompareMode;
    createFolderBtn.disabled = isCompareMode;
    deleteBtn.disabled = isCompareMode;
  };
  updateButtonsState();

  window.addEventListener('compare-mode:toggle', (e: Event) => {
    isCompareMode = (e as CustomEvent).detail.enabled;
    updateButtonsState();
  });

  const cacheActions = document.createElement('div');
  cacheActions.style.display = 'flex';
  cacheActions.style.gap = '4px';
  cacheActions.appendChild(promoteBtn);
  cacheActions.appendChild(createFolderBtn);
  cacheActions.appendChild(deleteBtn);

  cacheHeader.appendChild(cacheActions);

  cachePanel.appendChild(cacheHeader);

  const cacheList = document.createElement('div');
  cacheList.className = 'layer-cache__list';

  // State for active cache item
  let activeCacheItemIndices: Set<number> = new Set(options.initialState ? options.initialState.activeCacheIndices : []);
  let lastSelectedCacheIndex: number | null = options.initialState ? options.initialState.lastCacheIndex : null;
  const cacheItemElements: HTMLElement[] = [];
  let currentCaches: CachedImage[] = [];
  let currentCacheDefs: CacheDef[] = [];

  createFolderBtn.style.display = 'none'; // Disabled in new Zip backend

  promoteBtn.addEventListener('click', async () => {
    if (activeCacheItemIndices.size > 0) {
      if (!currentPsd) {
        showToast('PSDが開かれていません', false);
        return;
      }
      try {
        const sortedIndices = Array.from(activeCacheItemIndices).sort((a, b) => a - b);
        
        await commitStateChange(`キャッシュをレイヤーに昇格 (${sortedIndices.length}件)`, async () => {
          let activeIndex = currentLayerDefs.findIndex(l => l.active);
          
          let baseInsertIndex = currentLayerDefs.length;
          let insertDepth = 0;

          if (activeIndex !== -1) {
            const activeLayer = currentLayerDefs[activeIndex];
            if (activeLayer.isGroup) {
              insertDepth = (activeLayer.depth || 0) + 1;
              baseInsertIndex = currentLayerDefs.length;
              for (let i = activeIndex + 1; i < currentLayerDefs.length; i++) {
                if ((currentLayerDefs[i].depth || 0) <= (activeLayer.depth || 0)) {
                  baseInsertIndex = i;
                  break;
                }
              }
            } else {
              insertDepth = activeLayer.depth || 0;
              baseInsertIndex = currentLayerDefs.length;
              for (let i = activeIndex + 1; i < currentLayerDefs.length; i++) {
                if ((currentLayerDefs[i].depth || 0) < insertDepth) {
                  baseInsertIndex = i;
                  break;
                }
              }
            }
          }

          currentLayerDefs.forEach(l => l.active = false);

          let promotedCount = 0;
          for (let i = 0; i < sortedIndices.length; i++) {
            const cacheDef = currentCacheDefs[sortedIndices[i]];
            if (!cacheDef) continue;
            const cache = cacheDef.item;
            if (cache.type === 'folder') continue;
            
            let isText = false;
            if (cache.name.match(/\.(json|txt|md)$/i)) {
              isText = true;
            }

            const newLayer: any = {
              name: cache.name,
              hidden: false,
              opacity: 255,
              blendMode: 'normal'
            };

            let blob = cache.blob;
            if (!blob && cache.type === 'image') {
              const parts = cache.key.split('/');
              const zipName = parts[0];
              const path = parts.slice(1).join('/');
              blob = await extractArchiveFile(zipName, path);
            }
            
            if (isText) {
              newLayer.fileBlob = blob;
            } else {
              const bmp = await createImageBitmap(blob as Blob);
              const canvas = document.createElement('canvas');
              canvas.width = bmp.width;
              canvas.height = bmp.height;
              const ctx = canvas.getContext('2d');
              if (ctx) ctx.drawImage(bmp, 0, 0);
              newLayer.canvas = canvas;
              
              if (currentPsd) {
                if (bmp.width > currentPsd.width || bmp.height > currentPsd.height) {
                  throw new Error('画像のサイズが元のPSDのキャンバスに入らないため、昇格できませんでした。');
                }
              }
            }

            const newDef: LayerDef = {
              name: cache.name,
              iconName: isText ? 'description' : 'image',
              isGroup: false,
              isChild: insertDepth > 0,
              depth: insertDepth,
              active: i === sortedIndices.length - 1,
              layer: newLayer
            };

            currentLayerDefs.splice(baseInsertIndex + promotedCount, 0, newDef);
            promotedCount++;
          }

          if (promotedCount === 0) {
            throw new Error('昇格可能な画像が選択されていません');
          }

          if (currentPsd) currentPsd.children = rebuildPsdHierarchy(currentLayerDefs);
          renderLayerTree(currentLayerDefs);
          dispatchVisibilityChange(currentLayerDefs);
          window.dispatchEvent(new Event('document:redraw'));
        });

        showToast(`${sortedIndices.length}件のキャッシュをレイヤーに昇格しました`, 'success');
      } catch (err: any) {
        console.error(err);
        showToast(err.message || '昇格に失敗しました', 'error');
      }
    } else {
      showToast('昇格するキャッシュを選択してください', false);
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (activeCacheItemIndices.size > 0) {
      try {
        const deletedCaches: CachedImage[] = [];
        // Add all selected caches and their children if it's a folder
        const addCacheAndChildren = (cDef: CacheDef) => {
          if (!deletedCaches.some(c => c.key === cDef.item.key)) {
            deletedCaches.push(cDef.item);
          }
          if (cDef.item.type === 'folder') {
            const children = currentCacheDefs.filter(d => d.item.folderId === cDef.item.key);
            children.forEach(addCacheAndChildren);
          }
        };
        
        Array.from(activeCacheItemIndices).forEach(idx => {
          if (currentCacheDefs[idx]) {
            addCacheAndChildren(currentCacheDefs[idx]);
          }
        });
        
        // Find folders that will become empty after this deletion
        let allCachesTemp = [...currentCaches];
        let newlyDeletedCount = 1;
        while (newlyDeletedCount > 0) {
          newlyDeletedCount = 0;
          const remainingCaches = allCachesTemp.filter(c => !deletedCaches.some(d => d.key === c.key));
          const remainingFolders = remainingCaches.filter(c => c.type === 'folder');
          
          for (const folder of remainingFolders) {
            const hasChildren = remainingCaches.some(c => c.folderId === folder.key);
            if (!hasChildren) {
              deletedCaches.push(folder);
              newlyDeletedCount++;
            }
          }
        }
        
        const promises = deletedCaches.filter(c => c.type === 'folder' && !c.folderId).map(cache => deleteArchive(cache.key));
        await Promise.all(promises);

        historyManager.push({
          label: `アーカイブ削除 (${deletedCaches.length}件)`,
          execute: async () => {
            await Promise.all(deletedCaches.filter(c => c.type === 'folder' && !c.folderId).map(c => deleteArchive(c.key)));
            window.dispatchEvent(new Event('tool:cache-updated'));
          },
          undo: async () => {
            // Undo is disabled for backend zip deletion since we don't store backups
            window.dispatchEvent(new Event('tool:cache-updated'));
          }
        });

        showToast(`${deletedCaches.length}件のアーカイブを削除しました。`, 'success');
        const eventName = options.panelType === 'right' ? 'tool:result-cleared:right' : 'tool:result-cleared';
        window.dispatchEvent(new CustomEvent(eventName));
        // Refresh the list
        await loadCacheList();
      } catch (err) {
        console.error('Failed to delete cache', err);
        showToast(`削除に失敗しました`, 'error');
      }
    } else {
      showToast('削除するキャッシュを選択してください', false);
    }
  });

let cacheDraggedIndex: number | null = null;

  async function loadCacheList(autoSelectKey?: string) {
    cacheList.innerHTML = '';
    cacheItemElements.length = 0;
    
    if (!options.initialState || currentCaches.length > 0) {
      if (!autoSelectKey) {
        activeCacheItemIndices.clear();
        lastSelectedCacheIndex = null;
      }
    }
    currentCaches = [];
    currentCacheDefs = [];

    try {
      const caches = await getArchives();
      currentCaches = caches;
      
      const defs: CacheDef[] = [];
      const rootCaches = caches.filter(c => !c.folderId);
      
      const collapseState = getArchiveCollapseState();
      
      function traverse(items: CachedImage[], depth: number) {
        items.forEach(item => {
          const isGroup = item.type === 'folder';
          const collapsed = collapseState[item.key] !== undefined ? collapseState[item.key] : (item.collapsed || false);
          const def: CacheDef = {
            item,
            depth,
            isChild: depth > 0,
            isGroup,
            collapsed: collapsed,
            active: false
          };
          defs.push(def);
          if (isGroup) {
            const children = caches.filter(c => c.folderId === item.key);
            traverse(children, depth + 1);
          }
        });
      }
      traverse(rootCaches, 0);
      currentCacheDefs = defs;
      
      let skipDepth = -1;
      let activeGroupDepth = -1;

      currentCacheDefs.forEach((cDef, i) => {
        const c = cDef.item;
        const currentDepth = cDef.depth || 0;

        if (skipDepth !== -1) {
          if (currentDepth > skipDepth) {
            return;
          } else {
            skipDepth = -1;
          }
        }

        if (cDef.isGroup && cDef.collapsed && skipDepth === -1) {
          skipDepth = currentDepth;
        }

        const isAutoSelected = autoSelectKey && c.key === autoSelectKey;
        if (isAutoSelected || activeCacheItemIndices.has(i)) {
           if (isAutoSelected) {
              activeCacheItemIndices.add(i);
              lastSelectedCacheIndex = i;
           }
           cDef.active = true;
        }

        let inActiveGroup = false;
        if (activeGroupDepth !== -1) {
          if (currentDepth > activeGroupDepth) {
            inActiveGroup = true;
          } else {
            activeGroupDepth = -1;
          }
        }
        if (cDef.active && cDef.isGroup) {
          activeGroupDepth = currentDepth;
        }

        const item = document.createElement('div');
        item.dataset.index = i.toString();
        const classes = ['layer-item'];
        if (cDef.active) classes.push('layer-item--active');
        if (cDef.isGroup) classes.push('layer-item--group');
        if (cDef.isChild) classes.push('layer-item--child');
        item.className = classes.join(' ');
        
        if (inActiveGroup && !cDef.active) {
          item.style.backgroundColor = 'var(--color-surface-container-high)';
        }

        const indent = currentDepth * 16;
        item.style.paddingLeft = `${8 + indent}px`;

        // Chevron icon
        if (cDef.isGroup) {
          const chevronName = cDef.collapsed ? 'chevron_right' : 'expand_more';
          const chevronIcon = icon(chevronName, 16);
          chevronIcon.className = 'material-symbols-outlined layer-item__icon layer-item__icon--chevron';
          chevronIcon.style.cursor = 'pointer';
          chevronIcon.addEventListener('click', async (e) => {
            e.stopPropagation();
            cDef.collapsed = !cDef.collapsed;
            updateArchiveFolderCollapse(c.key, cDef.collapsed);
            await loadCacheList();
          });
          item.appendChild(chevronIcon);
        } else {
          const spacer = document.createElement('span');
          spacer.style.width = '16px';
          spacer.style.height = '16px';
          spacer.style.marginRight = '4px';
          spacer.style.display = 'inline-block';
          spacer.style.flexShrink = '0';
          item.appendChild(spacer);
        }

        // Type icon
        let isText = false;
        if (!cDef.isGroup && c.name.match(/\.(json|txt|md)$/i)) {
          isText = true;
        }
        const actualIconName = cDef.isGroup ? (cDef.collapsed ? 'folder' : 'folder_open') : (isText ? 'description' : 'image');
        const typeIcon = icon(actualIconName, 16);
        typeIcon.className = `material-symbols-outlined layer-item__icon ${cDef.active ? 'layer-item__icon--type-active' : 'layer-item__icon--type'}`;
        item.appendChild(typeIcon);
        
        const label = document.createElement('span');
        label.className = 'layer-item__name';
        
        let displayName = c.name;
        if (!cDef.isGroup && !displayName.includes('.')) {
          displayName += '.png';
        }
        
        label.textContent = displayName;
        label.title = displayName;
        if (cDef.active) label.style.color = 'var(--color-on-surface)';
        item.appendChild(label);
        
        if (!cDef.isGroup && !isText) {
          item.appendChild(createUTBoxes(`cache_${c.key}`, null, c.key));
        }
        
        label.addEventListener('dblclick', (e) => {
           e.stopPropagation();
           showToast('アーカイブ名の変更は現在サポートされていません', false);
        });
        
        item.addEventListener('click', (e: MouseEvent) => {
           if ((e.target as HTMLElement).tagName === 'INPUT') return;
           
           const updateUI = () => {
              cacheItemElements.forEach((el, idx) => {
                 const originalIndex = parseInt(el.dataset.index || '-1', 10);
                 if (originalIndex === -1) return;
                 const lDef = currentCacheDefs[originalIndex];
                 if (!lDef) return;
                 
                 const tActive = el.querySelector('.layer-item__icon--type-active');
                 const tInactive = el.querySelector('.layer-item__icon--type');
                 if (activeCacheItemIndices.has(originalIndex)) {
                    el.classList.add('layer-item--active');
                     if (tInactive) {
                        tInactive.classList.remove('layer-item__icon--type');
                        tInactive.classList.add('layer-item__icon--type-active');
                     }
                    const nameSpan = el.querySelector('.layer-item__name') as HTMLElement;
                    if (nameSpan) nameSpan.style.color = 'var(--color-on-surface)';
                 } else {
                    el.classList.remove('layer-item--active');
                     if (tActive) {
                        tActive.classList.remove('layer-item__icon--type-active');
                        tActive.classList.add('layer-item__icon--type');
                     }
                    const nameSpan = el.querySelector('.layer-item__name') as HTMLElement;
                    if (nameSpan) nameSpan.style.color = '';
                 }
              });

              if (activeCacheItemIndices.size === 1) {
                 const selectedIdx = Array.from(activeCacheItemIndices)[0];
                 const cCache = currentCacheDefs[selectedIdx].item;
                 if (cCache.type !== 'folder') {
                   const eventName = options.panelType === 'right' ? 'tool:result-ready:right' : 'tool:result-ready';
                   window.dispatchEvent(new CustomEvent(eventName, { detail: { key: cCache.key, toolName: cCache.name } }));
                 }
              } else {
                 const eventName = options.panelType === 'right' ? 'tool:result-cleared:right' : 'tool:result-cleared';
                 window.dispatchEvent(new CustomEvent(eventName));
              }
           };

           if (e.shiftKey && lastSelectedCacheIndex !== null) {
              const start = Math.min(lastSelectedCacheIndex, i);
              const end = Math.max(lastSelectedCacheIndex, i);
              
              if (!e.ctrlKey && !e.metaKey) {
                 activeCacheItemIndices.clear();
              }
              for (let j = start; j <= end; j++) {
                 activeCacheItemIndices.add(j);
              }
              updateUI();
           } else if (e.ctrlKey || e.metaKey) {
              if (activeCacheItemIndices.has(i)) {
                 activeCacheItemIndices.delete(i);
              } else {
                 activeCacheItemIndices.add(i);
              }
              lastSelectedCacheIndex = i;
              updateUI();
           } else {
              if (activeCacheItemIndices.size === 1 && activeCacheItemIndices.has(i)) {
                 activeCacheItemIndices.clear();
                 lastSelectedCacheIndex = null;
                 updateUI();
              } else {
                 activeCacheItemIndices.clear();
                 activeCacheItemIndices.add(i);
                 lastSelectedCacheIndex = i;
                 updateUI();
              }
           }
        });

        // Drag and drop for caches
        item.draggable = true;

        item.addEventListener('dragstart', (e) => {
          cacheDraggedIndex = i;
          item.classList.add('layer-item--dragging');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', i.toString());
          }
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('layer-item--dragging');
          cacheDraggedIndex = null;
          const allItems = cacheList.querySelectorAll('.layer-item');
          allItems.forEach(el => {
            el.classList.remove('layer-item--drag-over');
            (el as HTMLElement).style.boxShadow = '';
          });
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          if (cacheDraggedIndex !== null && cacheDraggedIndex !== i) {
            const draggedItem = currentCacheDefs[cacheDraggedIndex];
            let isChildOfDragged = false;
            if (draggedItem.isGroup) {
              const draggedDepth = draggedItem.depth || 0;
              for (let j = cacheDraggedIndex + 1; j <= i; j++) {
                if ((currentCacheDefs[j].depth || 0) <= draggedDepth) {
                  break;
                }
                if (j === i) isChildOfDragged = true;
              }
            }

            if (!isChildOfDragged) {
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
              
              item.classList.remove('layer-item--drag-over');
              item.style.boxShadow = '';

              const rect = item.getBoundingClientRect();
              const y = e.clientY - rect.top;
              
              if (cDef.isGroup) {
                if (y < rect.height * 0.25) {
                  item.style.boxShadow = 'inset 0 2px 0 var(--color-primary)';
                } else if (y > rect.height * 0.75) {
                  item.style.boxShadow = 'inset 0 -2px 0 var(--color-primary)';
                } else {
                  item.style.boxShadow = 'inset 0 0 0 2px var(--color-primary)';
                }
              } else {
                if (y < rect.height / 2) {
                  item.style.boxShadow = 'inset 0 2px 0 var(--color-primary)';
                } else {
                  item.style.boxShadow = 'inset 0 -2px 0 var(--color-primary)';
                }
              }
            }
          }
        });

        item.addEventListener('dragleave', () => {
          item.classList.remove('layer-item--drag-over');
          item.style.boxShadow = '';
        });

        item.addEventListener('drop', async (e) => {
          e.preventDefault();
          item.classList.remove('layer-item--drag-over');
          item.style.boxShadow = '';
          
          if (cacheDraggedIndex !== null && cacheDraggedIndex !== i) {
            try {
              const draggedDef = currentCacheDefs[cacheDraggedIndex];
              const rect = item.getBoundingClientRect();
              const y = e.clientY - rect.top;
              let position = 'before';

              if (cDef.isGroup) {
                if (y < rect.height * 0.25) position = 'before';
                else if (y > rect.height * 0.75) position = 'after';
                else position = 'inside';
              } else {
                if (y < rect.height / 2) position = 'before';
                else position = 'after';
              }

              let targetFolderId: string | null = null;

              if (position === 'inside') {
                targetFolderId = cDef.item.key;
                cDef.item.collapsed = false;
                updateArchiveFolderCollapse(cDef.item.key, false);
              } else {
                targetFolderId = cDef.item.folderId || null;
              }
              
              // Drag and drop for archives is currently disabled since the new zip backend does not support it.
              showToast('アーカイブの移動は現在サポートされていません', 'info');
            } catch (err) {
              console.error(err);
              showToast('キャッシュの移動に失敗しました', 'error');
            }
          }
        });

        cacheItemElements.push(item);
        cacheList.appendChild(item);
      });
    } catch (err) {
      console.error('Failed to load caches', err);
    }
  }

  loadCacheList();

  window.addEventListener('tool:cache-updated', (e: Event) => {
    const customEvent = e as CustomEvent;
    loadCacheList(customEvent.detail?.autoSelectKey);
  });

  cachePanel.appendChild(cacheList);
  aside.appendChild(cachePanel);

  (aside as any).getUIState = () => {
    return {
      layerDefs: currentLayerDefs,
      activeCacheIndices: Array.from(activeCacheItemIndices),
      lastCacheIndex: lastSelectedCacheIndex,
      psd: currentPsd
    };
  };

  return aside;
}

function mapPsdLayers(psdLayers: Layer[], depth = 0): LayerDef[] {
  const result: LayerDef[] = [];
  
  // ag-psd returns layers in order from top to bottom (index 0 is top).
  // UI layer lists are also top to bottom, so we iterate forwards.
  for (let i = 0; i < psdLayers.length; i++) {
    const layer = psdLayers[i];
    const isGroup = layer.children !== undefined;
    let layerName = layer.name || 'Unnamed Layer';
    
    if (!isGroup && !layerName.includes('.')) {
      layerName += '.png';
    }
    
    result.push({
      name: layerName,
      iconName: isGroup ? 'folder' : (layer.canvas || layer.imageData ? 'image' : 'layers'),
      isGroup: isGroup,
      isChild: depth > 0,
      depth: depth,
      hidden: layer.hidden,
      active: false,
      layer: layer,
    });

    if (layer.children) {
      result.push(...mapPsdLayers(layer.children, depth + 1));
    }
  }
  return result;
}

function rebuildPsdHierarchy(items: LayerDef[]): Layer[] {
  const rootLayers: Layer[] = [];
  const stack: { depth: number; layers: Layer[] }[] = [{ depth: -1, layers: rootLayers }];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const depth = item.depth || 0;
    
    while (stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    
    const parentList = stack[stack.length - 1].layers;
    
    if (item.isRoot) {
      stack.push({ depth: depth, layers: rootLayers });
    } else if (item.layer) {
      if (item.isGroup) {
        item.layer.children = [];
        parentList.push(item.layer);
        stack.push({ depth: depth, layers: item.layer.children });
      } else {
        item.layer.children = undefined;
        parentList.push(item.layer);
      }
    }
  }

  return rootLayers;
}
