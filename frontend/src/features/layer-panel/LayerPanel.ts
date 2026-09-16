/**
 * LayerPanel (ArchivePanel) — Sidebar dedicated to ARCHIVES management,
 * preview, and comparison.
 */
import { icon } from '../../shared/utils/dom';
import { showToast } from '../../shared/utils/toast';
import {
  getArchives,
  deleteArchive,
  restoreArchive,
  updateArchiveFolderCollapse,
  getArchiveCollapseState,
  getArchiveContents,
  deleteArchiveContents
} from '../../shared/utils/archives';
import { CachedImage } from '../../shared/utils/idb';
import { historyManager } from '../../shared/utils/history';
import { DocumentManager } from '../document/DocumentManager';

export let globalIsOverlayMode = false;
export let globalIsBatchMode = false;

window.addEventListener('overlay-mode:toggle', (e: Event) => {
  globalIsOverlayMode = (e as CustomEvent).detail.enabled;
  window.dispatchEvent(new Event('overlay-mode:changed'));
  window.dispatchEvent(new Event('document:redraw'));
});

window.addEventListener('batch-mode:toggle', (e: Event) => {
  globalIsBatchMode = (e as CustomEvent).detail.enabled;
  window.dispatchEvent(new Event('batch-mode:changed'));
});

interface CacheDef {
  item: CachedImage;
  depth: number;
  isChild: boolean;
  isGroup: boolean;
  collapsed: boolean;
  active: boolean;
}

export interface LayerPanelOptions {
  panelType?: 'left' | 'right';
  isCompareMode?: boolean;
  initialState?: {
    activeCacheIndices?: number[];
    lastCacheIndex?: number | null;
    [key: string]: any;
  };
}

export function createLayerPanel(options: LayerPanelOptions = {}): HTMLElement {
  let uLayerId: string | null = null;
  let uCacheKey: string | null = null;
  let uLayerName: string | null = null;

  const overlayUEvent = options.panelType === 'right' ? 'overlay:select-u:right' : 'overlay:select-u';

  window.addEventListener(overlayUEvent, (e: Event) => {
    const d = (e as CustomEvent).detail;
    uLayerId = d.id;
    uCacheKey = d.cacheKey;
    uLayerName = d.name || null;
    window.dispatchEvent(new Event('overlay-mode:changed'));
    window.dispatchEvent(new Event('document:redraw'));
  });

  function createUTBoxes(id: string, cacheKey: string | null, name: string) {
    const container = document.createElement('div');
    container.className = 'layer-item__ut-boxes';
    container.style.display = globalIsOverlayMode ? 'flex' : 'none';

    const uCb = document.createElement('div');
    uCb.className = 'layer-item__ut-cb';
    uCb.title = '下絵 (U) として選択';

    const sync = () => {
      container.style.display = globalIsOverlayMode ? 'flex' : 'none';

      const isU = (cacheKey && uCacheKey === cacheKey) || (!cacheKey && uLayerId === id);

      uCb.classList.toggle('layer-item__ut-cb--checked-u', !!isU);
    };

    uCb.addEventListener('click', (e) => {
      e.stopPropagation();
      const isU = (cacheKey && uCacheKey === cacheKey) || (!cacheKey && uLayerId === id);
      if (isU) {
        window.dispatchEvent(new CustomEvent(overlayUEvent, { detail: { id: null, cacheKey: null, name: null } }));
      } else {
        window.dispatchEvent(new CustomEvent(overlayUEvent, { detail: { id, cacheKey, name } }));
      }
    });

    container.appendChild(uCb);
    sync();
    window.addEventListener('overlay-mode:changed', () => sync());
    return container;
  }


  const aside = document.createElement('aside');
  aside.className = options.panelType === 'right' ? 'layer-panel layer-panel--right' : 'layer-panel';

  // ── Width Resizer ──
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
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    let newWidth: number;
    if (options.panelType === 'right') {
      newWidth = startWidth - (e.clientX - startX);
    } else {
      newWidth = startWidth + (e.clientX - startX);
    }
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

  // ── ARCHIVES Header ──
  const cacheHeader = document.createElement('div');
  cacheHeader.className = 'layer-cache__header';

  const cacheTitle = document.createElement('span');
  cacheTitle.className = 'layer-cache__title';
  cacheTitle.textContent = 'ARCHIVES';
  cacheHeader.appendChild(cacheTitle);

  const createFolderBtn = document.createElement('button');
  createFolderBtn.className = 'layer-panel__action-btn';
  createFolderBtn.title = 'フォルダ作成';
  createFolderBtn.appendChild(icon('create_new_folder', 16));
  createFolderBtn.style.display = 'none'; // Reserved for future folder support

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'layer-panel__action-btn';
  refreshBtn.title = 'ARCHIVESを更新';
  const refreshIcon = icon('refresh', 16);
  refreshBtn.appendChild(refreshIcon);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'layer-panel__action-btn';
  deleteBtn.title = 'アーカイブ削除';
  deleteBtn.appendChild(icon('delete', 16));

  let isCompareMode = options.isCompareMode || false;
  const updateButtonsState = () => {
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
  cacheActions.appendChild(createFolderBtn);
  cacheActions.appendChild(refreshBtn);
  cacheActions.appendChild(deleteBtn);
  cacheHeader.appendChild(cacheActions);

  aside.appendChild(cacheHeader);


  // ── Overlay Column Header (U/T labels above list) ──
  const columnHeader = document.createElement('div');
  columnHeader.className = 'overlay-column-header';
  if (globalIsOverlayMode) columnHeader.classList.add('overlay-column-header--visible');

  const colSpacer = document.createElement('div');
  colSpacer.className = 'overlay-column-header__spacer';
  columnHeader.appendChild(colSpacer);

  const colU = document.createElement('div');
  colU.className = 'overlay-column-header__label overlay-column-header__label--u';
  colU.textContent = 'U';
  colU.title = '下絵 (Underdrawing)';
  columnHeader.appendChild(colU);

  aside.appendChild(columnHeader);

  window.addEventListener('overlay-mode:changed', () => {
    columnHeader.classList.toggle('overlay-column-header--visible', globalIsOverlayMode);
  });

  // Auto-assign currently selected image to U when entering Overlay Mode
  window.addEventListener('overlay-mode:toggle', (e: Event) => {
    const enabled = (e as CustomEvent).detail.enabled;
    if (enabled && !uCacheKey && !uLayerId) {
      if (activeCacheItemIndices.size > 0 && lastSelectedCacheIndex !== null) {
        const activeDef = currentCacheDefs[lastSelectedCacheIndex];
        if (activeDef && !activeDef.isGroup) {
          const c = activeDef.item;
          let displayName = c.name;
          if (!displayName.includes('.')) displayName += '.png';
          window.dispatchEvent(new CustomEvent(overlayUEvent, { detail: { id: `cache_${c.key}`, cacheKey: c.key, name: displayName } }));
        }
      }
    }
  });

  // ── ARCHIVES List Container ──
  const cacheList = document.createElement('div');
  cacheList.className = 'layer-cache__list';
  cacheList.style.flex = '1';
  cacheList.style.height = '100%';

  let activeCacheItemIndices: Set<number> = new Set(
    options.initialState?.activeCacheIndices || []
  );
  let lastSelectedCacheIndex: number | null =
    options.initialState?.lastCacheIndex !== undefined ? options.initialState.lastCacheIndex : null;

  const cacheItemElements: HTMLElement[] = [];
  let currentCaches: CachedImage[] = [];
  let currentCacheDefs: CacheDef[] = [];
  const loadedArchiveContents: Record<string, CachedImage[]> = {};

  // Handle Archive Delete
  deleteBtn.addEventListener('click', async () => {
    if (activeCacheItemIndices.size > 0) {
      try {
        const sortedIndices = Array.from(activeCacheItemIndices).sort((a, b) => b - a);
        const deletedCaches = sortedIndices.map(idx => currentCacheDefs[idx].item);

        const archivesToDelete = new Set<string>();
        const filesToDeleteByArchive = new Map<string, string[]>();

        for (const cache of deletedCaches) {
          if (cache.type === 'folder' && !cache.folderId) {
            archivesToDelete.add(cache.key);
          } else {
            const slashIdx = cache.key.indexOf('/');
            if (slashIdx > -1) {
              const zipName = cache.key.substring(0, slashIdx);
              const path = cache.key.substring(slashIdx + 1);
              if (!archivesToDelete.has(zipName)) {
                let paths = filesToDeleteByArchive.get(zipName);
                if (!paths) {
                  paths = [];
                  filesToDeleteByArchive.set(zipName, paths);
                }
                paths.push(path);
              }
            }
          }
        }

        for (const zipName of archivesToDelete) {
          filesToDeleteByArchive.delete(zipName);
        }

        const executeDelete = async () => {
          const promises: Promise<void>[] = [];
          for (const zipName of archivesToDelete) {
            promises.push(deleteArchive(zipName));
          }
          for (const [zipName, paths] of filesToDeleteByArchive.entries()) {
            promises.push(deleteArchiveContents(zipName, paths));
          }
          await Promise.all(promises);
        };

        await executeDelete();

        historyManager.push({
          label: `アーカイブ削除 (${deletedCaches.length}件)`,
          execute: async () => {
            await executeDelete();
            window.dispatchEvent(new Event('tool:cache-updated'));
          },
          undo: async () => {
            await Promise.all(Array.from(archivesToDelete).map(zipName => restoreArchive(zipName)));
            window.dispatchEvent(new Event('tool:cache-updated'));
          }
        });

        const archiveCount = archivesToDelete.size;
        let fileCount = 0;
        for (const paths of filesToDeleteByArchive.values()) {
          fileCount += paths.length;
        }

        let msg = '';
        if (archiveCount > 0 && fileCount > 0) {
          msg = `${archiveCount}件のアーカイブと${fileCount}件のファイルを削除しました。`;
        } else if (archiveCount > 0) {
          msg = `${archiveCount}件のアーカイブを削除しました。`;
        } else {
          msg = `${fileCount}件のファイルを削除しました。`;
        }

        showToast(msg, 'success');
        const eventName = options.panelType === 'right' ? 'tool:result-cleared:right' : 'tool:result-cleared';
        window.dispatchEvent(new CustomEvent(eventName));
        await loadCacheList();
      } catch (err) {
        console.error('Failed to delete cache', err);
        showToast('削除に失敗しました', 'error');
      }
    } else {
      showToast('削除するアーカイブを選択してください', false);
    }
  });

  // Handle Archive Refresh
  refreshBtn.addEventListener('click', async () => {
    if (refreshBtn.disabled) return;
    refreshBtn.disabled = true;
    refreshIcon.classList.add('is-spinning');

    try {
      let previousSelectedKey: string | undefined;
      if (activeCacheItemIndices.size > 0 && lastSelectedCacheIndex !== null && currentCacheDefs[lastSelectedCacheIndex]) {
        previousSelectedKey = currentCacheDefs[lastSelectedCacheIndex].item.key;
      }

      await loadCacheList(previousSelectedKey, true);

      if (previousSelectedKey) {
        const stillExists = currentCacheDefs.some(d => d.item.key === previousSelectedKey);
        if (!stillExists) {
          const eventName = options.panelType === 'right' ? 'tool:result-cleared:right' : 'tool:result-cleared';
          window.dispatchEvent(new CustomEvent(eventName));
        }
      }

      showToast('ARCHIVESを最新の状態に更新しました', 'success');
    } catch (err) {
      console.error('Failed to refresh archives', err);
      showToast('アーカイブの更新に失敗しました', 'error');
    } finally {
      refreshIcon.classList.remove('is-spinning');
      refreshBtn.disabled = false;
    }
  });

  async function loadCacheList(autoSelectKey?: string, forceRefresh = false) {
    cacheList.innerHTML = '';
    cacheItemElements.length = 0;

    if (forceRefresh) {
      Object.keys(loadedArchiveContents).forEach(k => delete loadedArchiveContents[k]);
    }

    if (!options.initialState || currentCaches.length > 0) {
      if (!autoSelectKey) {
        activeCacheItemIndices.clear();
        lastSelectedCacheIndex = null;
      }
    }

    if (autoSelectKey) {
      const rootFolderKey = autoSelectKey.split('/')[0];
      updateArchiveFolderCollapse(rootFolderKey, false);
      delete loadedArchiveContents[rootFolderKey];
    }

    currentCaches = [];
    currentCacheDefs = [];

    try {
      const rootCaches = await getArchives();
      const allCaches = [...rootCaches];
      const collapseState = getArchiveCollapseState();

      if (autoSelectKey) {
        const cleanKey = autoSelectKey.replace(/\\/g, '/');
        const keyParts = cleanKey.split('/');
        let currentPath = '';
        for (let i = 0; i < keyParts.length - 1; i++) {
          currentPath = currentPath ? `${currentPath}/${keyParts[i]}` : keyParts[i];
          collapseState[currentPath] = false;
          updateArchiveFolderCollapse(currentPath, false);
        }
      }

      for (const root of rootCaches) {
        const isCollapsed = collapseState[root.key] !== undefined ? collapseState[root.key] : true;
        const isTargetRoot = autoSelectKey && (root.key === autoSelectKey.split('/')[0] || autoSelectKey.startsWith(root.key + '/'));
        if (!isCollapsed || isTargetRoot) {
          if (!loadedArchiveContents[root.key]) {
            loadedArchiveContents[root.key] = await getArchiveContents(root.key);
          }
          allCaches.push(...loadedArchiveContents[root.key]);
        }
      }

      currentCaches = allCaches;
      const defs: CacheDef[] = [];

      function traverse(items: CachedImage[], depth: number) {
        items.forEach(item => {
          const isGroup = item.type === 'folder';
          const collapsed = collapseState[item.key] !== undefined ? collapseState[item.key] : true;
          const def: CacheDef = {
            item,
            depth,
            isChild: depth > 0,
            isGroup,
            collapsed,
            active: false
          };
          defs.push(def);
          if (isGroup && !collapsed) {
            const children = allCaches.filter(c => c.folderId === item.key);
            traverse(children, depth + 1);
          }
        });
      }

      const rootItems = allCaches.filter(c => !c.folderId);
      traverse(rootItems, 0);

      currentCacheDefs = defs;

      if (autoSelectKey) {
        activeCacheItemIndices.clear();
        const cleanTarget = autoSelectKey.replace(/\\/g, '/');
        let foundIdx = currentCacheDefs.findIndex(d => d.item.key.replace(/\\/g, '/') === cleanTarget);
        if (foundIdx === -1) {
          const targetFilename = cleanTarget.split('/').pop()?.toLowerCase();
          const targetFolder = cleanTarget.split('/')[0];
          foundIdx = currentCacheDefs.findIndex(d => 
            d.item.folderId === targetFolder && d.item.name.toLowerCase() === targetFilename
          );
        }

        if (foundIdx !== -1) {
          activeCacheItemIndices.add(foundIdx);
          lastSelectedCacheIndex = foundIdx;
          currentCacheDefs[foundIdx].active = true;

          const cCache = currentCacheDefs[foundIdx].item;
          if (cCache.type !== 'folder') {
            const eventName = options.panelType === 'right' ? 'tool:result-ready:right' : 'tool:result-ready';
            window.dispatchEvent(new CustomEvent(eventName, { detail: { key: cCache.key, toolName: cCache.name } }));
          }
        }
      }

      let activeGroupDepth = -1;

      currentCacheDefs.forEach((cDef, i) => {
        const c = cDef.item;
        const currentDepth = cDef.depth || 0;
        const isActive = activeCacheItemIndices.has(i) || cDef.active;

        let inActiveGroup = false;
        if (activeGroupDepth !== -1) {
          if (currentDepth > activeGroupDepth) {
            inActiveGroup = true;
          } else {
            activeGroupDepth = -1;
          }
        }
        if (isActive && cDef.isGroup) {
          activeGroupDepth = currentDepth;
        }

        const isEffectivelySelected = isActive || inActiveGroup;

        const item = document.createElement('div');
        item.dataset.index = i.toString();
        const classes = ['layer-item'];
        if (isEffectivelySelected) classes.push('layer-item--selected');
        if (lastSelectedCacheIndex === i) classes.push('layer-item--active');
        if (cDef.isGroup) classes.push('layer-item--group');
        if (cDef.isChild) classes.push('layer-item--child');
        item.className = classes.join(' ');

        const indent = currentDepth * 16;
        item.style.paddingLeft = `${8 + indent}px`;

        if (cDef.isGroup) {
          const chevronName = cDef.collapsed ? 'chevron_right' : 'expand_more';
          const chevronIcon = icon(chevronName, 16);
          chevronIcon.className = 'material-symbols-outlined layer-item__icon layer-item__icon--chevron';
          chevronIcon.style.cursor = 'pointer';

          const toggleCollapse = async (e: Event) => {
            e.stopPropagation();
            const isNowCollapsed = !cDef.collapsed;

            if (!isNowCollapsed && !c.folderId && !loadedArchiveContents[c.key]) {
              chevronIcon.textContent = 'hourglass_empty';
              try {
                loadedArchiveContents[c.key] = await getArchiveContents(c.key);
              } catch (err) {
                showToast('読み込みに失敗しました', 'error');
                chevronIcon.textContent = 'chevron_right';
                return;
              }
            }

            cDef.collapsed = isNowCollapsed;
            updateArchiveFolderCollapse(c.key, cDef.collapsed);
            await loadCacheList();
          };

          chevronIcon.addEventListener('click', toggleCollapse);
          item.appendChild(chevronIcon);
          item.addEventListener('dblclick', toggleCollapse);
        } else {
          const spacer = document.createElement('span');
          spacer.style.width = '16px';
          spacer.style.height = '16px';
          spacer.style.marginRight = '4px';
          spacer.style.display = 'inline-block';
          spacer.style.flexShrink = '0';
          item.appendChild(spacer);
        }

        let isText = false;
        if (!cDef.isGroup && c.name.match(/\.(json|txt|md)$/i)) {
          isText = true;
        }
        const actualIconName = cDef.isGroup
          ? (cDef.collapsed ? 'folder' : 'folder_open')
          : (isText ? 'description' : 'image');
        const typeIcon = icon(actualIconName, 16);
        typeIcon.className = `material-symbols-outlined layer-item__icon ${
          isEffectivelySelected ? 'layer-item__icon--type-active' : 'layer-item__icon--type'
        }`;
        item.appendChild(typeIcon);

        const label = document.createElement('span');
        label.className = 'layer-item__name';

        let displayName = c.name;
        if (!cDef.isGroup && !displayName.includes('.')) {
          displayName += '.png';
        }

        label.textContent = displayName;
        label.title = displayName;
        if (isEffectivelySelected) label.style.color = 'var(--color-on-surface)';
        item.appendChild(label);

        if (!cDef.isGroup && !isText) {
          item.appendChild(createUTBoxes(`cache_${c.key}`, c.key, displayName));
        }

        item.addEventListener('click', (e: MouseEvent) => {
          const updateUI = () => {
            let activeGroupDepth = -1;

            cacheItemElements.forEach((el) => {
              const originalIndex = parseInt(el.dataset.index || '-1', 10);
              if (originalIndex === -1) return;
              const lDef = currentCacheDefs[originalIndex];
              if (!lDef) return;

              const isDirectlySelected = activeCacheItemIndices.has(originalIndex);
              
              let inActiveGroup = false;
              if (activeGroupDepth !== -1) {
                if (lDef.depth > activeGroupDepth) {
                  inActiveGroup = true;
                } else {
                  activeGroupDepth = -1;
                }
              }
              
              if (isDirectlySelected && lDef.isGroup) {
                activeGroupDepth = lDef.depth;
              }

              const isEffectivelySelected = isDirectlySelected || inActiveGroup;

              const tActive = el.querySelector('.layer-item__icon--type-active');
              const tInactive = el.querySelector('.layer-item__icon--type');
              if (isEffectivelySelected) {
                el.classList.add('layer-item--selected');
                if (tInactive) {
                  tInactive.classList.remove('layer-item__icon--type');
                  tInactive.classList.add('layer-item__icon--type-active');
                }
                const nameSpan = el.querySelector('.layer-item__name') as HTMLElement;
                if (nameSpan) nameSpan.style.color = 'var(--color-on-surface)';
              } else {
                el.classList.remove('layer-item--selected');
                if (tActive) {
                  tActive.classList.remove('layer-item__icon--type-active');
                  tActive.classList.add('layer-item__icon--type');
                }
                const nameSpan = el.querySelector('.layer-item__name') as HTMLElement;
                if (nameSpan) nameSpan.style.color = '';
              }
              if (lastSelectedCacheIndex === originalIndex) {
                el.classList.add('layer-item--active');
              } else {
                el.classList.remove('layer-item--active');
              }
            });

            if (activeCacheItemIndices.size === 1) {
              const selectedIdx = Array.from(activeCacheItemIndices)[0];
              const cCache = currentCacheDefs[selectedIdx].item;
              const docManager = DocumentManager.getInstance();
              const cDef = currentCacheDefs[selectedIdx];
              if (cDef.isGroup) {
                docManager.setCurrentArchiveFolder(cCache.key);
                if (globalIsBatchMode) {
                  const loadChildren = async () => {
                    const rootKey = cCache.key.split('/')[0];
                    let items = loadedArchiveContents[rootKey];
                    if (!items) {
                      try {
                        items = await getArchiveContents(rootKey);
                        loadedArchiveContents[rootKey] = items;
                      } catch (e) {
                        console.error('Failed to load archive contents', e);
                        items = [];
                      }
                    }
                    const childImages = items.filter(c => 
                      c.type !== 'folder' && 
                      (c.folderId === cCache.key || c.key.startsWith(cCache.key + '/'))
                    ).map(c => ({ key: c.key, toolName: c.name }));
                    
                    if (childImages.length > 0) {
                      const eventName = options.panelType === 'right' ? 'tool:batch-result-ready:right' : 'tool:batch-result-ready';
                      window.dispatchEvent(new CustomEvent(eventName, { detail: { items: childImages } }));
                    }
                  };
                  loadChildren();
                }
              } else {
                const folder = cCache.folderId || (cCache.key.includes('/') ? cCache.key.split('/')[0] : null);
                if (folder) {
                  docManager.setCurrentArchiveFolder(folder);
                }
                if (!globalIsBatchMode) {
                  const eventName = options.panelType === 'right' ? 'tool:result-ready:right' : 'tool:result-ready';
                  window.dispatchEvent(new CustomEvent(eventName, { detail: { key: cCache.key, toolName: cCache.name } }));
                }
              }
            } else if (activeCacheItemIndices.size > 1) {
              const docManager = DocumentManager.getInstance();
              const selectedItems = Array.from(activeCacheItemIndices)
                .map(idx => currentCacheDefs[idx])
                .filter(d => !d.isGroup)
                .map(d => d.item);
              if (selectedItems.length > 0) {
                const firstFolder = selectedItems[0].folderId || (selectedItems[0].key.includes('/') ? selectedItems[0].key.split('/')[0] : null);
                if (firstFolder) {
                  docManager.setCurrentArchiveFolder(firstFolder);
                }
                if (!globalIsBatchMode) {
                  const eventName = options.panelType === 'right' ? 'tool:batch-result-ready:right' : 'tool:batch-result-ready';
                  window.dispatchEvent(new CustomEvent(eventName, { 
                    detail: { 
                      items: selectedItems.map(c => ({ key: c.key, toolName: c.name }))
                    } 
                  }));
                }
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
              if (lastSelectedCacheIndex === i) lastSelectedCacheIndex = null;
            } else {
              activeCacheItemIndices.add(i);
              lastSelectedCacheIndex = i;
            }
            updateUI();
          } else {
            if (activeCacheItemIndices.size === 1 && activeCacheItemIndices.has(i)) {
              // Toggle off when clicking the already selected item
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

        cacheList.appendChild(item);
        cacheItemElements.push(item);
      });

      // Restore initial selection visual state if any
      if (activeCacheItemIndices.size > 0 && autoSelectKey) {
        activeCacheItemIndices.forEach(idx => {
          const el = cacheItemElements.find(e => e.dataset.index === idx.toString());
          if (el) {
            el.scrollIntoView({ block: 'nearest' });
          }
        });
      }
    } catch (err) {
      console.error('Failed to load archives', err);
    }
  }

  loadCacheList();

  window.addEventListener('tool:cache-updated', (e: Event) => {
    const customEvent = e as CustomEvent;
    loadCacheList(customEvent.detail?.autoSelectKey, true);
  });

  aside.appendChild(cacheList);

  (aside as any).getUIState = () => {
    return {
      activeCacheIndices: Array.from(activeCacheItemIndices),
      lastCacheIndex: lastSelectedCacheIndex
    };
  };

  return aside;
}
