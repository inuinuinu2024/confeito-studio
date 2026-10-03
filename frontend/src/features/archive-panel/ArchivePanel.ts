/**
 * ArchivePanel — the ARCHIVES tree (left sidebar; a second instance replaces the AI panel in
 * Compare mode and emits the `:right` variants of its events).
 *
 * Selecting a file emits `archive:item-selected` (the canvas shows it); a folder or several entries
 * emit `archive:selection-summary` (the canvas shows no image), or `archive:batch-selected` in
 * Batch mode. Every selection also updates DocumentManager's current archive folder, which tools save into.
 * Folder expansion state is shared by both instances and reset on app start; reloading the tree
 * keeps the selection by key (docs/specs/archives.md 「選択」).
 */
import './archive-panel.css';
import {
  deleteArchive,
  deleteArchiveContents,
  getArchiveContents,
  getArchives,
  restoreArchive,
  restoreArchiveContents,
} from '../../shared/api/archives';
import { TEXT_FILE_PATTERN } from '../../shared/config';
import { emit, on } from '../../shared/events';
import { isViewMode } from '../../shared/state/view-mode';
import type { ArchiveEntry } from '../../shared/types/archive';
import { h, icon } from '../../shared/ui/dom';
import { createResizer } from '../../shared/ui/resizer';
import { showError, showToast } from '../../shared/ui/toast';
import { historyManager } from '../../shared/utils/history';
import { DocumentManager } from '../document/DocumentManager';
import {
  ancestorKeys,
  buildTreeRows,
  type CollapseState,
  displayName,
  effectiveSelection,
  findRowIndex,
  imagesUnder,
  isCollapsed,
  planDeletion,
  remapSelection,
  selectedFiles,
  withoutTextFiles,
  type TreeRow,
} from './archive-tree';

/** Shared by the left and right panels; not persisted. */
const collapseState: CollapseState = {};

export interface SelectionState {
  selected: number[];
  last: number | null;
}

export interface ArchivePanelOptions {
  side?: 'left' | 'right';
  /** Selection to start with (the compare panel copies the left panel's selection). */
  initialState?: SelectionState;
}

export interface ArchivePanel {
  el: HTMLElement;
  getSelectionState(): SelectionState;
  /** Unsubscribes every listener (the compare-mode panel is recreated each time). */
  destroy(): void;
}

export function createArchivePanel(options: ArchivePanelOptions = {}): ArchivePanel {
  const isRight = options.side === 'right';
  const events = {
    selected: isRight ? 'archive:item-selected:right' : 'archive:item-selected',
    cleared: isRight ? 'archive:selection-cleared:right' : 'archive:selection-cleared',
    summary: isRight ? 'archive:selection-summary:right' : 'archive:selection-summary',
    underdrawing: isRight ? 'overlay:underdrawing-selected:right' : 'overlay:underdrawing-selected',
  } as const;
  const disposers: (() => void)[] = [];
  const docManager = () => DocumentManager.getInstance();

  // ── State ──
  let rows: TreeRow[] = [];
  let rowElements: HTMLElement[] = [];
  const selected = new Set<number>(options.initialState?.selected ?? []);
  let lastSelected: number | null = options.initialState?.last ?? null;
  let hasLoaded = false;
  const contentsCache: Record<string, ArchiveEntry[]> = {};
  let underdrawingKey: string | null = null;

  // ── DOM ──
  const aside = h('aside', { class: isRight ? 'layer-panel layer-panel--right' : 'layer-panel' });
  const refreshIcon = icon('refresh', 16);
  const refreshBtn = h('button', { class: 'layer-panel__action-btn', title: 'ARCHIVESを更新' }, refreshIcon);
  const deleteBtn = h('button', { class: 'layer-panel__action-btn', title: 'アーカイブ削除' }, icon('delete', 16));
  const columnHeader = h(
    'div',
    { class: 'overlay-column-header' },
    h('div', { class: 'overlay-column-header__spacer' }),
    h('div', { class: 'overlay-column-header__label', text: 'U', title: '下絵 (Underdrawing)' }),
  );
  const list = h('div', { class: 'layer-cache__list' });

  aside.append(
    isRight
      ? createResizer(aside, '--right-sidebar-width', 'left', 'ai-panel__resizer')
      : createResizer(aside, '--left-sidebar-width', 'right', 'layer-panel__resizer'),
    h(
      'div',
      { class: 'layer-cache__header' },
      h('span', { class: 'layer-cache__title', text: 'ARCHIVES' }),
      h('div', { class: 'layer-cache__actions' }, refreshBtn, deleteBtn),
    ),
    columnHeader,
    list,
  );

  const listen: typeof on = (name, handler) => {
    const off = on(name, handler);
    disposers.push(off);
    return off;
  };

  // ── Overlay (U = underdrawing) checkboxes ──
  const syncOverlayUI = () => {
    const overlay = isViewMode('overlay');
    columnHeader.classList.toggle('overlay-column-header--visible', overlay);
    for (const box of list.querySelectorAll<HTMLElement>('.layer-item__ut-boxes')) {
      box.style.display = overlay ? 'flex' : 'none';
      box.firstElementChild?.classList.toggle('layer-item__ut-cb--checked-u', box.dataset.key === underdrawingKey);
    }
  };

  const selectUnderdrawing = (key: string | null, name: string | null) =>
    emit(events.underdrawing, { id: key ? `cache_${key}` : null, cacheKey: key, name });

  const underdrawingBox = (key: string, name: string) => {
    const checkbox = h('div', { class: 'layer-item__ut-cb', title: '下絵 (U) として選択' });
    checkbox.addEventListener('click', e => {
      e.stopPropagation();
      if (underdrawingKey === key) selectUnderdrawing(null, null);
      else selectUnderdrawing(key, name);
    });
    return h('div', { class: 'layer-item__ut-boxes', dataset: { key } }, checkbox);
  };

  listen(events.underdrawing, detail => {
    underdrawingKey = detail.cacheKey;
    emit('overlay-mode:changed');
    emit('document:redraw');
  });
  listen('overlay-mode:changed', syncOverlayUI);
  listen('overlay-mode:toggle', ({ enabled }) => {
    syncOverlayUI();
    // Entering Overlay mode uses the selected image as the underdrawing.
    if (enabled && !underdrawingKey && selected.size > 0 && lastSelected !== null) {
      const row = rows[lastSelected];
      if (row && !row.isGroup) selectUnderdrawing(row.item.key, displayName(row));
    }
  });

  // ── Selection ──
  const applySelectionStyles = () => {
    const effective = effectiveSelection(rows, selected);
    rowElements.forEach((el, i) => {
      el.classList.toggle('layer-item--selected', effective[i]);
      el.classList.toggle('layer-item--active', lastSelected === i);
      const typeIcon = el.querySelector('.layer-item__type-icon');
      typeIcon?.classList.toggle('layer-item__icon--type-active', effective[i]);
      typeIcon?.classList.toggle('layer-item__icon--type', !effective[i]);
    });
  };

  /** Publishes the current selection to the canvas / DocumentManager. */
  const publishSelection = async () => {
    if (selected.size === 0) {
      emit(events.cleared);
      return;
    }
    if (selected.size > 1) {
      const selectedRows = [...selected].map(i => rows[i]);
      const firstFile = selectedRows.find(r => !r.isGroup);
      // The first file's parent folder; only folders selected -> the first folder.
      const folder = firstFile ? folderOf(firstFile.item) : selectedRows[0].item.key;
      if (folder) docManager().setCurrentArchiveFolder(folder);
      // Batch mode shows the selected files (folders ignored) in tree order.
      if (isViewMode('batch')) publishBatch(selectedFiles(rows, selected));
      else emit(events.summary, { kind: 'multiple', count: selected.size });
      return;
    }
    const row = rows[[...selected][0]];
    if (row.isGroup) {
      docManager().setCurrentArchiveFolder(row.item.key);
      if (isViewMode('batch')) await publishFolderBatch(row.item.key);
      else emit(events.summary, { kind: 'folder', name: displayName(row), count: 1 });
      return;
    }
    const folder = folderOf(row.item);
    if (folder) docManager().setCurrentArchiveFolder(folder);
    if (isViewMode('batch')) publishBatch([row.item]);
    else emit(events.selected, { key: row.item.key, name: row.item.name });
  };

  /** Batch mode grid of image files; text files are skipped and an empty list keeps the current view. */
  const publishBatch = (files: ArchiveEntry[]) => {
    const images = withoutTextFiles(files).map(e => ({ key: e.key, name: e.name }));
    if (images.length && !isRight) emit('archive:batch-selected', { items: images });
  };

  const publishFolderBatch = async (folderKey: string) => {
    const root = folderKey.split('/')[0];
    contentsCache[root] ??= await getArchiveContents(root);
    publishBatch(imagesUnder(contentsCache[root], folderKey));
  };

  const onRowClick = (i: number, e: MouseEvent) => {
    if (e.shiftKey && lastSelected !== null) {
      if (!e.ctrlKey && !e.metaKey) selected.clear();
      for (let j = Math.min(lastSelected, i); j <= Math.max(lastSelected, i); j++) selected.add(j);
    } else if (e.ctrlKey || e.metaKey) {
      if (selected.delete(i)) {
        if (lastSelected === i) lastSelected = null;
      } else {
        selected.add(i);
        lastSelected = i;
      }
    } else if (selected.size === 1 && selected.has(i)) {
      selected.clear(); // clicking the selected item again deselects it
      lastSelected = null;
    } else {
      selected.clear();
      selected.add(i);
      lastSelected = i;
    }
    applySelectionStyles();
    void publishSelection();
  };

  // ── Rendering ──
  const toggleFolder = async (row: TreeRow, chevron: HTMLElement, e: Event) => {
    e.stopPropagation();
    const collapse = !row.collapsed;
    if (!collapse && !row.item.folderId && !contentsCache[row.item.key]) {
      chevron.textContent = 'hourglass_empty';
      contentsCache[row.item.key] = await getArchiveContents(row.item.key);
    }
    collapseState[row.item.key] = collapse;
    await reload();
  };

  const renderRow = (row: TreeRow, i: number) => {
    const el = h('div', {
      class: ['layer-item', row.isGroup && 'layer-item--group', row.depth > 0 && 'layer-item--child']
        .filter(Boolean)
        .join(' '),
      style: { paddingLeft: `${8 + row.depth * 16}px` },
      dataset: { index: String(i) },
    });
    const isText = !row.isGroup && TEXT_FILE_PATTERN.test(row.item.name);

    if (row.isGroup) {
      const chevron = icon(row.collapsed ? 'chevron_right' : 'expand_more', 16);
      chevron.className = 'material-symbols-outlined layer-item__icon layer-item__icon--chevron';
      const toggle = (e: Event) => void toggleFolder(row, chevron, e);
      chevron.addEventListener('click', toggle);
      el.addEventListener('dblclick', toggle);
      el.append(chevron);
    } else {
      el.append(h('span', { class: 'layer-item__spacer' }));
    }

    const typeIcon = icon(
      row.isGroup ? (row.collapsed ? 'folder' : 'folder_open') : isText ? 'description' : 'image',
      16,
    );
    typeIcon.className = 'material-symbols-outlined layer-item__icon layer-item__type-icon layer-item__icon--type';
    const name = displayName(row);
    el.append(typeIcon, h('span', { class: 'layer-item__name', text: name, title: name }));
    if (!row.isGroup && !isText) el.append(underdrawingBox(row.item.key, name));
    el.addEventListener('click', e => onRowClick(i, e));
    return el;
  };

  /**
   * Reloads the tree from the backend; `autoSelectKey` expands to and selects that entry.
   * Otherwise the selection is kept by key: entries no longer shown (deleted, or hidden by collapsing
   * a folder) are deselected, and the canvas is updated when that changed the selection.
   * Resolves true when the selection changed (and was published).
   */
  async function reload(autoSelectKey?: string, forceRefresh = false): Promise<boolean> {
    if (forceRefresh) for (const key of Object.keys(contentsCache)) delete contentsCache[key];
    // The compare panel keeps its initial selection (indices from the left panel) on the first load.
    const keepSelection = !autoSelectKey && hasLoaded;
    const previousRows = rows;
    hasLoaded = true;
    let selectionChanged = false;

    const targetRoot = autoSelectKey?.split('/')[0];
    if (autoSelectKey) {
      for (const key of ancestorKeys(autoSelectKey)) collapseState[key] = false;
      if (targetRoot) {
        collapseState[targetRoot] = false;
        delete contentsCache[targetRoot];
      }
    }

    try {
      const roots = await getArchives();
      const entries = [...roots];
      for (const root of roots) {
        if (isCollapsed(collapseState, root.key) && root.key !== targetRoot) continue;
        contentsCache[root.key] ??= await getArchiveContents(root.key);
        entries.push(...contentsCache[root.key]);
      }
      rows = buildTreeRows(entries, collapseState);

      let autoSelected: TreeRow | null = null;
      if (autoSelectKey) {
        selected.clear();
        const index = findRowIndex(rows, autoSelectKey);
        if (index !== -1) {
          selected.add(index);
          lastSelected = index;
          autoSelected = rows[index];
        }
      } else if (keepSelection) {
        const kept = remapSelection(previousRows, selected, lastSelected, rows);
        selected.clear();
        for (const i of kept.selected) selected.add(i);
        lastSelected = kept.last;
        selectionChanged = kept.changed;
      }

      rowElements = rows.map(renderRow);
      list.replaceChildren(...rowElements);
      applySelectionStyles();
      syncOverlayUI();

      if (autoSelected) {
        if (!autoSelected.isGroup) emit(events.selected, { key: autoSelected.item.key, name: autoSelected.item.name });
        for (const i of selected) rowElements[i]?.scrollIntoView({ block: 'nearest' });
      }
      if (selectionChanged) await publishSelection();
    } catch (err) {
      console.error('Failed to load archives', err);
    }
    return selectionChanged;
  }

  // ── Header actions ──
  const updateDeleteButton = () => {
    deleteBtn.disabled = isViewMode('compare');
  };
  listen('compare-mode:toggle', updateDeleteButton);
  updateDeleteButton();

  deleteBtn.addEventListener('click', async () => {
    if (selected.size === 0) {
      showToast('削除するアーカイブを選択してください', 'warning');
      return;
    }
    try {
      const items = [...selected].sort((a, b) => b - a).map(i => rows[i].item);
      const plan = planDeletion(items);
      const run = async () => {
        await Promise.all([
          ...plan.archives.map(name => deleteArchive(name)),
          ...[...plan.contents].map(([name, paths]) => deleteArchiveContents(name, paths)),
        ]);
      };
      await run();
      historyManager.push({
        label: `アーカイブ削除 (${items.length}件)`,
        execute: async () => {
          await run();
          emit('archives:changed');
        },
        // Everything deleted went to .trash (archives and files / sub folders alike).
        undo: async () => {
          try {
            await Promise.all([
              ...plan.archives.map(name => restoreArchive(name)),
              ...[...plan.contents].map(([name, paths]) => restoreArchiveContents(name, paths)),
            ]);
          } catch (err) {
            console.error('Failed to restore deleted items', err);
            showError('削除を元に戻せませんでした', err);
          }
          emit('archives:changed');
        },
      });

      const fileCount = [...plan.contents.values()].reduce((n, paths) => n + paths.length, 0);
      const archiveCount = plan.archives.length;
      showToast(
        archiveCount && fileCount
          ? `${archiveCount}件のアーカイブと${fileCount}件のファイルを削除しました。`
          : archiveCount
            ? `${archiveCount}件のアーカイブを削除しました。`
            : `${fileCount}件のファイルを削除しました。`,
        'success',
      );
      emit(events.cleared);
      // Same as the refresh button: drop cached folder contents so deleted files disappear.
      emit('archives:changed');
    } catch (err) {
      console.error('Failed to delete cache', err);
      showError('削除に失敗しました', err);
    }
  });

  refreshBtn.addEventListener('click', async () => {
    if (refreshBtn.disabled) return;
    refreshBtn.disabled = true;
    refreshIcon.classList.add('is-spinning');
    try {
      // Entries that still exist stay selected and are shown again (their files may have changed).
      const changed = await reload(undefined, true);
      if (!changed && selected.size > 0) await publishSelection();
      showToast('ARCHIVESを最新の状態に更新しました', 'success');
    } catch (err) {
      console.error('Failed to refresh archives', err);
      showError('ARCHIVES を更新できませんでした', err);
    } finally {
      refreshIcon.classList.remove('is-spinning');
      refreshBtn.disabled = false;
    }
  });

  listen('archives:changed', detail => void reload(detail?.autoSelectKey, true));
  // Back from Batch mode: show the current selection the Normal way (Batch only drew a grid).
  listen('batch-mode:toggle', ({ enabled }) => {
    if (!enabled && !isRight) void publishSelection();
  });
  void reload();

  return {
    el: aside,
    getSelectionState: () => ({ selected: [...selected], last: lastSelected }),
    destroy: () => disposers.forEach(off => off()),
  };
}

/** Folder that tools should save into for a selected file: its parent folder, else its archive. */
function folderOf(item: ArchiveEntry): string | null {
  return item.folderId || (item.key.includes('/') ? item.key.split('/')[0] : null);
}
