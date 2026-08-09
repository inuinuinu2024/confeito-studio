/**
 * LayerPanel — Left sidebar with layer tree and layer properties inspector.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';
import type { Psd, Layer } from 'ag-psd';
import { getAllImageCaches, deleteImageCache, renameImageCache, CachedImage } from '../../shared/utils/idb';

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
  layer?: Layer;
}

const layers: LayerDef[] = [
  { name: 'Character 1',       iconName: 'folder_open', isGroup: true, depth: 0 },
  { name: 'Inks_Clean',        iconName: 'image',       isChild: true, depth: 1, active: true, badge: 'Focus AI' },
  { name: 'Rough_Sketch',      iconName: 'brush',       isChild: true, depth: 1 },
  { name: 'Background',        iconName: 'folder',      isGroup: true, spaced: true, depth: 0 },
  { name: 'Screentones_Global', iconName: 'grid_on',     isGroup: true, spaced: true, depth: 0 },
  { name: 'Paper_Base',        iconName: 'layers',      isGroup: true, depth: 0 },
];

export function createLayerPanel(): HTMLElement {
  let currentLayerDefs: LayerDef[] = [...layers];

  const aside = document.createElement('aside');
  aside.className = 'layer-panel';
  
  // ── Resizer ──
  const resizer = document.createElement('div');
  resizer.className = 'layer-panel__resizer';
  
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
    const newWidth = startWidth + (e.clientX - startX);
    // Add constraints
    if (newWidth > 150 && newWidth < 600) {
      document.documentElement.style.setProperty('--left-sidebar-width', `${newWidth}px`);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
    }
  });

  aside.appendChild(resizer);

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'layer-panel__header';

  const title = document.createElement('span');
  title.className = 'layer-panel__title';
  title.textContent = 'Layers';
  header.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'layer-panel__actions';
  const showAllBtn = document.createElement('button');
  showAllBtn.className = 'layer-panel__action-btn';
  showAllBtn.title = '全て表示';
  showAllBtn.appendChild(icon('visibility', 16));
  showAllBtn.addEventListener('click', () => {
    currentLayerDefs.forEach(l => {
      l.hidden = false;
      if (l.layer) l.layer.hidden = false;
    });
    if (currentPsd) {
      currentPsd.children = rebuildPsdHierarchy(currentLayerDefs);
    }
    renderLayerTree(currentLayerDefs);
    window.dispatchEvent(new Event('document:redraw'));
    showToast('全て表示しました', 'success');
  });
  actions.appendChild(showAllBtn);

  const hideAllBtn = document.createElement('button');
  hideAllBtn.className = 'layer-panel__action-btn';
  hideAllBtn.title = '全て非表示';
  hideAllBtn.appendChild(icon('visibility_off', 16));
  hideAllBtn.addEventListener('click', () => {
    currentLayerDefs.forEach(l => {
      l.hidden = true;
      if (l.layer) l.layer.hidden = true;
    });
    if (currentPsd) {
      currentPsd.children = rebuildPsdHierarchy(currentLayerDefs);
    }
    renderLayerTree(currentLayerDefs);
    window.dispatchEvent(new Event('document:redraw'));
    showToast('全て非表示にしました', 'success');
  });
  actions.appendChild(hideAllBtn);

  const createGroupBtn = document.createElement('button');
  createGroupBtn.className = 'layer-panel__action-btn';
  createGroupBtn.title = 'グループ作成';
  createGroupBtn.appendChild(icon('folder', 16));
  createGroupBtn.addEventListener('click', () => {
    const newGroupDef: LayerDef = {
      name: 'New Group',
      iconName: 'folder',
      isGroup: true,
      depth: 0,
      active: true,
      layer: { name: 'New Group', children: [] }
    };

    currentLayerDefs.forEach(l => l.active = false);
    currentLayerDefs.push(newGroupDef);

    if (currentPsd) {
      currentPsd.children = rebuildPsdHierarchy(currentLayerDefs);
    }
    
    renderLayerTree(currentLayerDefs);
    window.dispatchEvent(new Event('document:redraw'));
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
    for (let i = 0; i < items.length; i++) {
      const layerDef = items[i];
      const item = document.createElement('div');
      const classes = ['layer-item'];
      if (layerDef.active) classes.push('layer-item--active');
      if (layerDef.isGroup) classes.push('layer-item--group');
      if (layerDef.isChild) classes.push('layer-item--child');
      if (layerDef.spaced) classes.push('layer-item--spaced');
      if (layerDef.hidden) classes.push('layer-item--hidden');
      item.className = classes.join(' ');

      // Click to select
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return; // Don't trigger when clicking input

        const wasActive = layerDef.active;
        items.forEach((l) => (l.active = false));
        layerDef.active = !wasActive;
        
        // Instead of full re-render, update DOM states manually to allow dblclick to fire
        const allItems = tree.querySelectorAll('.layer-item:not(.layer-item--drop-zone)');
        allItems.forEach((el, index) => {
          const lDef = items[index];
          if (!lDef) return;
          if (lDef.active) {
            el.classList.add('layer-item--active');
            const nameSpan = el.querySelector('.layer-item__name') as HTMLElement;
            if (nameSpan) nameSpan.style.color = 'var(--color-on-surface)';
            const typeIcon = el.querySelector('.layer-item__icon--type');
            if (typeIcon) {
              typeIcon.classList.remove('layer-item__icon--type');
              typeIcon.classList.add('layer-item__icon--type-active');
            }
          } else {
            el.classList.remove('layer-item--active');
            const nameSpan = el.querySelector('.layer-item__name') as HTMLElement;
            if (nameSpan) nameSpan.style.color = '';
            if (!lDef.isGroup) {
              const typeIconActive = el.querySelector('.layer-item__icon--type-active');
              if (typeIconActive) {
                typeIconActive.classList.remove('layer-item__icon--type-active');
                typeIconActive.classList.add('layer-item__icon--type');
              }
            }
          }
        });
        
        window.dispatchEvent(new CustomEvent('layer:selected', {
          detail: { layer: layerDef.active ? layerDef.layer : null }
        }));
      });

      // Drag and drop
      item.draggable = true;

      item.addEventListener('dragstart', (e) => {
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
        allItems.forEach(el => el.classList.remove('layer-item--drag-over'));
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
            item.classList.add('layer-item--drag-over');
          }
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('layer-item--drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('layer-item--drag-over');
        if (draggedIndex !== null && draggedIndex !== i) {
          const draggedItem = items[draggedIndex];
          const draggedDepth = draggedItem.depth || 0;
          let draggedCount = 1;

          if (draggedItem.isGroup) {
            for (let j = draggedIndex + 1; j < items.length; j++) {
              if ((items[j].depth || 0) > draggedDepth) {
                draggedCount++;
              } else {
                break;
              }
            }
          }

          if (i >= draggedIndex && i < draggedIndex + draggedCount) {
            return; // Dropping inside itself
          }

          const movingItems = items.splice(draggedIndex, draggedCount);
          let insertIndex = i;
          if (draggedIndex < i) {
            insertIndex -= draggedCount;
          }

          const targetDepth = items[insertIndex] ? (items[insertIndex].depth || 0) : 0;
          const depthDiff = targetDepth - draggedDepth;
          if (depthDiff !== 0) {
            for (const movingItem of movingItems) {
              movingItem.depth = (movingItem.depth || 0) + depthDiff;
              movingItem.isChild = (movingItem.depth > 0);
            }
          }

          items.splice(insertIndex, 0, ...movingItems);
          
          if (currentPsd) {
            currentPsd.children = rebuildPsdHierarchy(items);
          }

          renderLayerTree(items);
          window.dispatchEvent(new Event('document:redraw'));
        }
      });

      // Visibility icon
      const visIconName = layerDef.hidden ? 'visibility_off' : 'visibility';
      const visIcon = icon(visIconName, 16);
      visIcon.className = 'material-symbols-outlined layer-item__icon layer-item__icon--vis';
      if (layerDef.hidden) {
        visIcon.style.opacity = '0.4';
        item.style.opacity = '0.6';
      }

      visIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetHidden = !layerDef.hidden;
        layerDef.hidden = targetHidden;
        if (layerDef.layer) layerDef.layer.hidden = targetHidden;

        // Toggle children if it's a group
        if (layerDef.isGroup) {
          const targetDepth = layerDef.depth || 0;
          for (let j = i + 1; j < items.length; j++) {
            const childDef = items[j];
            const childDepth = childDef.depth ?? (childDef.isChild ? 1 : 0);
            if (childDepth > targetDepth) {
              childDef.hidden = targetHidden;
              if (childDef.layer) childDef.layer.hidden = targetHidden;
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
            if (parentDef.layer) parentDef.layer.hidden = shouldHideParent;
            currentItemIndex = parentIndex; // Bubble up to parent
          } else {
            break; // Stop bubbling if parent state didn't change
          }
        }

        renderLayerTree(items);
        window.dispatchEvent(new Event('document:redraw'));
      });

      item.appendChild(visIcon);

      // Type icon
      const typeIcon = icon(layerDef.iconName, 16);
      typeIcon.className = `material-symbols-outlined layer-item__icon ${
        layerDef.active || layerDef.isGroup ? 'layer-item__icon--type-active' : 'layer-item__icon--type'
      }`;
      item.appendChild(typeIcon);

      // Name
      const name = document.createElement('span');
      name.className = 'layer-item__name';
      name.textContent = layerDef.name;
      if (layerDef.active) name.style.color = 'var(--color-on-surface)';
      
      name.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = layerDef.name;
        input.className = 'layer-item__name-input';
        
        const saveName = () => {
          layerDef.name = input.value || 'Unnamed Layer';
          if (layerDef.layer) layerDef.layer.name = layerDef.name;
          renderLayerTree(items);
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
        const draggedItem = items[draggedIndex];
        const draggedDepth = draggedItem.depth || 0;
        let draggedCount = 1;

        if (draggedItem.isGroup) {
          for (let j = draggedIndex + 1; j < items.length; j++) {
            if ((items[j].depth || 0) > draggedDepth) {
              draggedCount++;
            } else {
              break;
            }
          }
        }

        if (draggedIndex + draggedCount === items.length) {
          return; // Already at the bottom
        }

        const movingItems = items.splice(draggedIndex, draggedCount);
        
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
      }
    });
    tree.appendChild(dropZone);
  };

  // Initial render with dummy data
  renderLayerTree(currentLayerDefs);

  let currentPsd: Psd | null = null;

  // Listen for PSD loaded event
  window.addEventListener('document:loaded', (e: Event) => {
    const customEvent = e as CustomEvent<{ psd: Psd; filename: string }>;
    const psd = customEvent.detail.psd;
    const filename = customEvent.detail.filename;

    currentPsd = psd;
    title.textContent = filename;

    if (psd.children) {
      currentLayerDefs = mapPsdLayers(psd.children);
      renderLayerTree(currentLayerDefs);
    }
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
  cacheTitle.textContent = 'CACHE';
  cacheHeader.appendChild(cacheTitle);

  const promoteBtn = document.createElement('button');
  promoteBtn.className = 'layer-panel__action-btn';
  promoteBtn.title = 'レイヤーに昇格';
  promoteBtn.appendChild(icon('arrow_upward', 16));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'layer-panel__action-btn';
  deleteBtn.title = 'キャッシュ削除';
  deleteBtn.appendChild(icon('delete', 16));

  const cacheActions = document.createElement('div');
  cacheActions.style.display = 'flex';
  cacheActions.style.gap = '4px';
  cacheActions.appendChild(promoteBtn);
  cacheActions.appendChild(deleteBtn);

  cacheHeader.appendChild(cacheActions);

  cachePanel.appendChild(cacheHeader);

  const cacheList = document.createElement('div');
  cacheList.className = 'layer-cache__list';

  // State for active cache item
  let activeCacheItemIndices: Set<number> = new Set();
  let lastSelectedCacheIndex: number | null = null;
  const cacheItemElements: HTMLElement[] = [];
  let currentCaches: CachedImage[] = [];

  promoteBtn.addEventListener('click', async () => {
    if (activeCacheItemIndices.size > 0) {
      if (!currentPsd) {
        showToast('PSDが開かれていません', false);
        return;
      }
      try {
        const sortedIndices = Array.from(activeCacheItemIndices).sort((a, b) => a - b);
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

        for (let i = 0; i < sortedIndices.length; i++) {
          const cache = currentCaches[sortedIndices[i]];
          const bmp = await createImageBitmap(cache.blob);
          const canvas = document.createElement('canvas');
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(bmp, 0, 0);

          const newLayer = {
            name: cache.name,
            canvas: canvas,
            hidden: false,
            opacity: 255,
            blendMode: 'normal'
          };

          const newDef: LayerDef = {
            name: cache.name,
            iconName: 'image',
            isGroup: false,
            isChild: insertDepth > 0,
            depth: insertDepth,
            active: i === sortedIndices.length - 1, // Make the last promoted layer active
            layer: newLayer
          };

          currentLayerDefs.splice(baseInsertIndex + i, 0, newDef);
        }

        currentPsd.children = rebuildPsdHierarchy(currentLayerDefs);
        renderLayerTree(currentLayerDefs);
        window.dispatchEvent(new Event('document:redraw'));

        showToast(`${sortedIndices.length}件のキャッシュをレイヤーに昇格しました`, 'success');
      } catch (err) {
        console.error(err);
        showToast('昇格に失敗しました', 'error');
      }
    } else {
      showToast('昇格するキャッシュを選択してください', false);
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (activeCacheItemIndices.size > 0) {
      try {
        const promises = Array.from(activeCacheItemIndices).map(idx => {
          const cache = currentCaches[idx];
          return deleteImageCache(cache.key);
        });
        await Promise.all(promises);
        showToast(`${activeCacheItemIndices.size}件のキャッシュを削除しました。`, 'success');
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

  async function loadCacheList(autoSelectKey?: string) {
    cacheList.innerHTML = '';
    cacheItemElements.length = 0;
    activeCacheItemIndices.clear();
    lastSelectedCacheIndex = null;
    currentCaches = [];

    try {
      const caches = await getAllImageCaches();
      currentCaches = caches;
      caches.forEach((c, i) => {
        const item = document.createElement('div');
        item.className = 'layer-item';
        
        const typeIcon = document.createElement('div');
        typeIcon.className = 'layer-item__icon layer-item__icon--type';
        typeIcon.appendChild(icon('image', 16));
        item.appendChild(typeIcon);
        
        const label = document.createElement('span');
        label.className = 'layer-item__name';
        label.textContent = c.name;
        item.appendChild(label);
        
        label.addEventListener('dblclick', (e) => {
           e.stopPropagation();
           
           const input = document.createElement('input');
           input.type = 'text';
           input.value = c.name;
           input.className = 'layer-item__name-input';

           const finishEditing = async () => {
              const newName = input.value.trim() || '';
              if (!newName || newName === c.name) {
                 if (item.contains(input)) item.replaceChild(label, input);
                 return;
              }
              
              const isDuplicate = currentCaches.some(cache => cache.key !== c.key && cache.name === newName);
              if (isDuplicate) {
                 showToast(`エラー: 「${newName}」は既に存在します`, 'error');
                 if (item.contains(input)) item.replaceChild(label, input);
                 return;
              }

              try {
                 await renameImageCache(c.key, newName);
                 c.name = newName;
                 label.textContent = newName;
                 showToast(`名前を「${newName}」に変更しました`, 'success');
              } catch (err) {
                 console.error(err);
                 showToast('名前の変更に失敗しました', 'error');
              } finally {
                 if (item.contains(input)) item.replaceChild(label, input);
              }
           };

           input.addEventListener('blur', finishEditing, { once: true });
           input.addEventListener('keydown', (ke) => {
              if (ke.key === 'Enter') {
                 ke.preventDefault();
                 input.blur();
              } else if (ke.key === 'Escape') {
                 if (item.contains(input)) item.replaceChild(label, input);
              }
           });

           item.replaceChild(input, label);
           input.focus();
           input.select();
        });

        if (autoSelectKey && c.key === autoSelectKey) {
           activeCacheItemIndices.add(i);
           lastSelectedCacheIndex = i;
           item.classList.add('layer-item--active');
           typeIcon.classList.remove('layer-item__icon--type');
           typeIcon.classList.add('layer-item__icon--type-active');
        }
        
        item.addEventListener('click', (e: MouseEvent) => {
           if ((e.target as HTMLElement).tagName === 'INPUT') return;
           
           const updateUI = () => {
              cacheItemElements.forEach((el, idx) => {
                 const tActive = el.querySelector('.layer-item__icon--type-active');
                 const tInactive = el.querySelector('.layer-item__icon--type');
                 if (activeCacheItemIndices.has(idx)) {
                    el.classList.add('layer-item--active');
                    if (tInactive) {
                       tInactive.classList.remove('layer-item__icon--type');
                       tInactive.classList.add('layer-item__icon--type-active');
                    }
                 } else {
                    el.classList.remove('layer-item--active');
                    if (tActive) {
                       tActive.classList.remove('layer-item__icon--type-active');
                       tActive.classList.add('layer-item__icon--type');
                    }
                 }
              });

              if (activeCacheItemIndices.size === 1) {
                 const selectedIdx = Array.from(activeCacheItemIndices)[0];
                 const cCache = currentCaches[selectedIdx];
                 window.dispatchEvent(new CustomEvent('tool:result-ready', { detail: { key: cCache.key, toolName: cCache.name } }));
              } else {
                 window.dispatchEvent(new CustomEvent('tool:result-cleared'));
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

  return aside;
}

function mapPsdLayers(psdLayers: Layer[], depth = 0): LayerDef[] {
  const result: LayerDef[] = [];
  
  // ag-psd returns layers in order from bottom to top (like Photoshop internal).
  // Usually UI layer lists are top to bottom. So we iterate backwards.
  for (let i = psdLayers.length - 1; i >= 0; i--) {
    const layer = psdLayers[i];
    const isGroup = layer.children !== undefined;
    
    result.push({
      name: layer.name || 'Unnamed Layer',
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
    
    if (item.layer) {
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

  function reverseLayers(layers: Layer[]) {
    layers.reverse();
    for (const l of layers) {
      if (l.children) reverseLayers(l.children);
    }
  }
  
  reverseLayers(rootLayers);
  
  return rootLayers;
}
