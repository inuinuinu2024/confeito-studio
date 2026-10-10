/**
 * Archive Manager (docs/specs/archive-manager.md) — the "archive" view mode: every archive in one list, in place
 * of the canvas. Archives are the app's own data: they leave and enter the app here (zip export / import through
 * the browser) and through the Workspace's image export, not by opening the folder.
 *
 * - Rows: thumbnail (the first page), display name (renamed in place; the archive's key = folder name stays),
 *   created, images / results, size. A click opens the archive in the Workspace.
 * - Checked rows are exported (one zip) or deleted (to the trash: undo with Ctrl+Z / the undo button, the same
 *   history as the Workspace's deletions).
 * - Import: the file picker or zip files dropped on the list; every archive in them is added as a new one.
 *
 * Reloaded when the mode opens, with the refresh button and on archives:changed while shown.
 * Inputs (events): archive-mode:toggle, archives:changed, archives:location-changed, history:changed
 */
import './archive-manager.css';
import {
  type ArchiveSummary,
  exportArchives,
  getArchiveDetails,
  importArchives,
  renameArchive,
} from '../../shared/api/archives';
import { emit, on } from '../../shared/events';
import { isViewMode, setViewMode } from '../../shared/state/view-mode';
import { confirmDialog } from '../../shared/ui/dialogs';
import { h, icon, setShown } from '../../shared/ui/dom';
import { button, iconButton } from '../../shared/ui/form';
import { showError, showToast } from '../../shared/ui/toast';
import { displayNameError, filterArchives, formatSize } from '../../shared/utils/archives';
import { downloadBlob } from '../../shared/utils/download';
import { historyManager } from '../../shared/utils/history';
import { deleteTargets } from '../flow-canvas/deletion';
import { thumbnailUrl } from '../flow-canvas/thumbnails';

const ZIP_PATTERN = /\.zip$/i;

export function createArchiveManager(): HTMLElement {
  // ── State ──
  let archives: ArchiveSummary[] = [];
  /** Checked archive keys. */
  const checked = new Set<string>();
  /** Archives added by the last import (marked in the list until the next import). */
  let imported = new Set<string>();
  let query = '';
  let busy = false;
  let loadRequest = 0;

  // ── DOM ──
  const subtitle = h('span', { class: 'archive-manager__subtitle' });
  const search = h('input', { class: 'cs-input archive-manager__search', type: 'search', placeholder: '名前で検索' });
  const importButton = button('インポート', () => chooseImportFiles(), {
    title: 'zip ファイルからアーカイブを読み込む',
  });
  const exportButton = button('エクスポート', () => void exportChecked(), {
    variant: 'primary',
    title: 'チェックしたアーカイブを zip で書き出す',
  });
  const deleteButton = iconButton('delete', 'チェックしたアーカイブを削除', () => void deleteChecked(), 18);
  const undoButton = iconButton('undo', '削除を元に戻す (Ctrl+Z)', () => void historyManager.undo(), 18);
  const refreshButton = iconButton('refresh', '最新の状態に更新', () => void reload({ toast: true }), 18);
  const header = h(
    'div',
    { class: 'archive-manager__header' },
    h(
      'div',
      { class: 'archive-manager__heading' },
      h('h2', { class: 'archive-manager__title', text: 'Archive Manager' }),
      subtitle,
    ),
    search,
    importButton,
    exportButton,
    deleteButton,
    undoButton,
    refreshButton,
  );
  const checkAll = h('input', { type: 'checkbox', class: 'archive-row__check', title: '表示中のすべてを選択' });
  const listHead = h(
    'div',
    { class: 'archive-row archive-row--head' },
    h('label', { class: 'archive-row__check-cell' }, checkAll),
    h('span', { class: 'archive-row__thumb-cell' }),
    h('span', { class: 'archive-row__name-cell', text: '名前' }),
    h('span', { class: 'archive-row__created', text: '作成日時' }),
    h('span', { class: 'archive-row__counts', text: '内容' }),
    h('span', { class: 'archive-row__size', text: '容量' }),
    h('span', { class: 'archive-row__open-cell' }),
  );
  const listBody = h('div', { class: 'archive-list__body' });
  const list = h('div', { class: 'archive-list' }, listHead, listBody);
  const emptyMessage = h('div', { class: 'archive-manager__empty' });
  const selectionInfo = h('span', { class: 'archive-manager__selection' });
  const inner = h('div', { class: 'archive-manager__inner' }, header, selectionInfo, list, emptyMessage);
  const dropHint = h(
    'div',
    { class: 'archive-manager__drop' },
    icon('upload_file', 40),
    h('span', { text: 'zip ファイルをドロップしてアーカイブを読み込む' }),
  );
  const root = h('section', { class: 'archive-manager' }, inner, dropHint);

  // ── Thumbnails: loaded when their row comes into view ──
  const thumbnailObserver = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target as HTMLImageElement;
        thumbnailObserver.unobserve(img);
        const key = img.dataset.key;
        if (!key) continue;
        void thumbnailUrl(key).then(url => {
          if (url) img.src = url;
          else img.replaceWith(icon('hide_image', 24));
        });
      }
    },
    { root: inner },
  );

  // ── Rendering ──
  const visible = () => filterArchives(archives, query);

  const syncButtons = () => {
    const shown = visible();
    const count = checked.size;
    exportButton.disabled = busy || count === 0;
    deleteButton.disabled = busy || count === 0 || historyManager.isBusy();
    importButton.disabled = busy;
    undoButton.disabled = !historyManager.canUndo();
    checkAll.checked = shown.length > 0 && shown.every(a => checked.has(a.key));
    checkAll.indeterminate = !checkAll.checked && shown.some(a => checked.has(a.key));
    selectionInfo.textContent = count ? `${count} 件を選択中` : '';
  };

  const renderRow = (archive: ArchiveSummary): HTMLElement => {
    const check = h('input', { type: 'checkbox', class: 'archive-row__check', checked: checked.has(archive.key) });
    check.addEventListener('change', () => {
      if (check.checked) checked.add(archive.key);
      else checked.delete(archive.key);
      row.classList.toggle('archive-row--checked', check.checked);
      syncButtons();
    });
    let thumb: HTMLElement;
    if (archive.cover) {
      const img = h('img', { class: 'archive-row__thumb', alt: '', draggable: false, dataset: { key: archive.cover } });
      thumbnailObserver.observe(img);
      thumb = img;
    } else {
      thumb = icon('image', 24);
    }
    const nameText = h('span', { class: 'archive-row__name', text: archive.name, title: archive.name });
    const editButton = iconButton('edit', '名前を変更', () => startRename(archive, nameCell), 16);
    editButton.classList.add('archive-row__edit');
    const nameCell = h('div', { class: 'archive-row__name-cell' }, nameText, editButton);
    if (imported.has(archive.key)) nameCell.append(h('span', { class: 'archive-row__badge', text: '読み込み済み' }));
    const openButton = iconButton('open_in_new', 'Workspace で開く', () => openInWorkspace(archive.key), 18);
    const row = h(
      'div',
      {
        class: `archive-row${checked.has(archive.key) ? ' archive-row--checked' : ''}${imported.has(archive.key) ? ' archive-row--new' : ''}`,
        title: 'クリックで Workspace に開く',
        dataset: { key: archive.key },
      },
      h('label', { class: 'archive-row__check-cell', onclick: (e: MouseEvent) => e.stopPropagation() }, check),
      h('span', { class: 'archive-row__thumb-cell' }, thumb),
      nameCell,
      h('span', { class: 'archive-row__created', text: archive.created_at.slice(0, 16) }),
      h('span', { class: 'archive-row__counts', text: `画像 ${archive.images} 枚・結果 ${archive.results} 件` }),
      h('span', { class: 'archive-row__size', text: formatSize(archive.size) }),
      h('span', { class: 'archive-row__open-cell' }, openButton),
    );
    row.addEventListener('click', e => {
      if ((e.target as HTMLElement).closest('button, input, label')) return;
      openInWorkspace(archive.key);
    });
    return row;
  };

  const render = () => {
    for (const key of [...checked]) if (!archives.some(a => a.key === key)) checked.delete(key);
    const shown = visible();
    thumbnailObserver.disconnect();
    listBody.replaceChildren(...shown.map(renderRow));
    const total = archives.reduce((sum, a) => sum + a.size, 0);
    subtitle.textContent = archives.length ? `${archives.length} 件・${formatSize(total)}` : '';
    setShown(list, shown.length > 0);
    setShown(emptyMessage, shown.length === 0);
    emptyMessage.textContent = archives.length
      ? `「${query.trim()}」に一致するアーカイブはありません。`
      : 'アーカイブがありません。「インポート」で zip を読み込むか、Workspace で画像を読み込んでください。';
    syncButtons();
  };

  const reload = async (opts: { toast?: boolean } = {}) => {
    const request = ++loadRequest;
    root.classList.add('archive-manager--loading');
    try {
      const rows = await getArchiveDetails();
      if (request !== loadRequest) return;
      archives = rows;
      render();
      if (opts.toast) showToast('最新の状態に更新しました', 'success');
    } catch (err) {
      if (request === loadRequest) showError('アーカイブの一覧を読み込めませんでした', err);
    } finally {
      if (request === loadRequest) root.classList.remove('archive-manager--loading');
    }
  };

  // ── Actions ──
  const openInWorkspace = (key: string) => {
    emit('archives:changed', { archive: key, select: [] });
    setViewMode('normal');
  };

  const startRename = (archive: ArchiveSummary, cell: HTMLElement) => {
    const input = h('input', { class: 'cs-input archive-row__name-input', value: archive.name, maxLength: 200 });
    const previous = [...cell.childNodes];
    let done = false;
    const finish = async (commit: boolean) => {
      if (done) return;
      const name = input.value.trim();
      if (commit && name !== archive.name) {
        const error = displayNameError(name);
        if (error) {
          showToast(error, 'warning');
          input.focus();
          return;
        }
        done = true;
        input.disabled = true;
        try {
          await renameArchive(archive.key, name);
          showToast(`アーカイブの名前を「${name}」に変更しました`, 'success');
          emit('archives:changed', undefined);
          return; // the list is reloaded by archives:changed
        } catch (err) {
          showError('アーカイブの名前を変更できませんでした', err);
        }
      }
      done = true;
      cell.replaceChildren(...previous);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') void finish(true);
      else if (e.key === 'Escape') {
        e.stopPropagation();
        void finish(false);
      }
    });
    input.addEventListener('blur', () => void finish(true));
    input.addEventListener('click', e => e.stopPropagation());
    cell.replaceChildren(input);
    input.focus();
    input.select();
  };

  const checkedArchives = () => archives.filter(a => checked.has(a.key));

  const exportChecked = async () => {
    const targets = checkedArchives();
    if (!targets.length || busy) return;
    busy = true;
    exportButton.textContent = '書き出し中…';
    syncButtons();
    try {
      const file = await exportArchives(targets.map(a => a.key));
      downloadBlob(file.blob, file.name);
      showToast(`アーカイブ ${targets.length} 件を ${file.name} に書き出しました`, 'success');
    } catch (err) {
      showError('アーカイブを書き出せませんでした', err);
    } finally {
      busy = false;
      exportButton.textContent = 'エクスポート';
      syncButtons();
    }
  };

  const deleteChecked = async () => {
    const targets = checkedArchives();
    if (!targets.length || busy || historyManager.isBusy()) return;
    const images = targets.reduce((sum, a) => sum + a.images, 0);
    const what = targets.length === 1 ? `アーカイブ「${targets[0].name}」` : `アーカイブ ${targets.length} 件`;
    const ok = await confirmDialog({
      title: '削除の確認',
      message: `${what}を削除します（画像 ${images} 枚）。\nCtrl+Z で元に戻せます（アプリを終了するまで）。`,
      confirmLabel: '削除',
    });
    if (!ok) return;
    for (const a of targets) checked.delete(a.key);
    await deleteTargets(targets.map(a => ({ archive: a.key, path: '', name: a.name })));
  };

  const importFiles = async (files: File[]) => {
    const zips = files.filter(f => ZIP_PATTERN.test(f.name) || f.type === 'application/zip');
    if (zips.length < files.length) showToast('zip ファイル以外は読み込めません', 'warning');
    if (!zips.length || busy) return;
    busy = true;
    importButton.textContent = '読み込み中…';
    syncButtons();
    const added: { key: string; name: string }[] = [];
    try {
      for (const file of zips) {
        try {
          const result = await importArchives(file);
          for (const warning of result.warnings) showToast(warning, 'warning');
          added.push(...result.imported);
        } catch (err) {
          showError(`「${file.name}」をインポートできませんでした`, err);
        }
      }
    } finally {
      busy = false;
      importButton.textContent = 'インポート';
    }
    if (added.length) {
      imported = new Set(added.map(a => a.key));
      query = '';
      search.value = '';
      showToast(
        added.length === 1 ? `「${added[0].name}」を読み込みました` : `アーカイブ ${added.length} 件を読み込みました`,
        'success',
      );
      emit('archives:changed', undefined);
    } else {
      syncButtons();
    }
  };

  const chooseImportFiles = () => {
    const input = h('input', { type: 'file', accept: '.zip,application/zip', multiple: true });
    input.addEventListener('change', () => void importFiles([...(input.files ?? [])]));
    input.click();
  };

  // ── Events ──
  search.addEventListener('input', () => {
    query = search.value;
    render();
  });
  checkAll.addEventListener('change', () => {
    for (const a of visible()) {
      if (checkAll.checked) checked.add(a.key);
      else checked.delete(a.key);
    }
    render();
  });

  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  root.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    dragDepth++;
    root.classList.add('archive-manager--dragging');
  });
  root.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) root.classList.remove('archive-manager--dragging');
  });
  root.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  root.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    root.classList.remove('archive-manager--dragging');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void importFiles(files);
  });

  // The list is read again whenever the mode opens; while it is shown, every change reloads it.
  const refreshWhenShown = () => {
    if (isViewMode('archive')) void reload();
  };
  on('archive-mode:toggle', ({ enabled }) => {
    if (enabled) void reload();
  });
  on('archives:changed', refreshWhenShown);
  on('archives:location-changed', () => {
    checked.clear();
    imported = new Set();
    refreshWhenShown();
  });
  on('history:changed', syncButtons);

  render();
  return root;
}
