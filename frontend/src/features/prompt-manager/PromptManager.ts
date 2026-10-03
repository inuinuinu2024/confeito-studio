/**
 * Prompt Manager (docs/specs/prompt-manager.md) — the "prompt" view mode. The sidebar (categories)
 * takes the place of ARCHIVES and the main area (prompt list | editor) the place of the canvas;
 * app.ts shows them while the mode is on. Every change is saved to the backend at once, except the
 * editor, which saves with 保存 / Ctrl+S and asks before unsaved changes are left.
 */
import './prompt-manager.css';
import { on } from '../../shared/events';
import {
  createPrompt,
  deletePrompt,
  duplicatePrompt,
  listPrompts,
  movePrompt,
  type PromptStore,
  renameCategory,
  reorderCategories,
  reorderPrompts,
  type SavedPrompt,
  updatePrompt,
} from '../../shared/api/prompts';
import { isViewMode, setLeaveGuard } from '../../shared/state/view-mode';
import { choiceDialog, confirmDialog } from '../../shared/ui/dialogs';
import { enableDragSort } from '../../shared/ui/drag-sort';
import { h, icon, setShown } from '../../shared/ui/dom';
import { button, field, suggestInput } from '../../shared/ui/form';
import { createResizer } from '../../shared/ui/resizer';
import { showError, showToast } from '../../shared/ui/toast';
import {
  type CategoryFilter,
  categoryLabel,
  countByCategory,
  displayCategories,
  findByName,
  groupPrompts,
  isSortable,
  MAX_CATEGORY_LENGTH,
  MAX_NAME_LENGTH,
  normalizeCategory,
  promptInputError,
  UNCATEGORIZED_LABEL,
} from '../../shared/utils/prompts';
import { chooseImportFile, exportPrompts } from './transfer';

/** dataTransfer type of a prompt dragged onto a category. */
const PROMPT_MIME = 'application/x-confeito-prompt';

interface PromptFields {
  name: string;
  category: string;
  text: string;
}

/** The prompt open in the editor: `id` null for a new one not saved yet; `saved` is what 保存 last wrote. */
interface Editing {
  id: string | null;
  saved: PromptFields;
}

const isDialogOpen = () => !!document.querySelector('.cs-modal-overlay--open, dialog[open]');

function showWarnings(warnings: string[]): void {
  for (const warning of warnings) showToast(warning, 'warning');
}

export function createPromptManager(): { sidebar: HTMLElement; main: HTMLElement } {
  let store: PromptStore = { categories: [], prompts: [] };
  let filter: CategoryFilter = null;
  let query = '';
  let editing: Editing | null = null;
  let saving = false;

  // ── Sidebar: categories ──
  const sidebar = h('aside', { class: 'pm-sidebar' });
  const categoryList = h('div', { class: 'pm-categories' });
  const actionButton = (iconName: string, title: string, onClick: () => void) =>
    h('button', { class: 'pm-sidebar__action-btn', title, onclick: onClick }, icon(iconName, 16));
  sidebar.append(
    createResizer(sidebar, '--left-sidebar-width', 'right', 'pm-sidebar__resizer'),
    h(
      'div',
      { class: 'pm-sidebar__header' },
      h('span', { class: 'pm-sidebar__title', text: 'PROMPTS' }),
      h(
        'div',
        { class: 'pm-sidebar__actions' },
        actionButton('refresh', '再読み込み', () => void load()),
        actionButton(
          'upload',
          'インポート',
          () => void chooseImportFile().then(changed => (changed ? load() : undefined)),
        ),
        actionButton('download', 'エクスポート', () => void exportPrompts()),
      ),
    ),
    categoryList,
  );

  // ── Main: prompt list | editor ──
  const search = h('input', { type: 'search', class: 'cs-input pm-list__search', placeholder: '名前・本文で検索' });
  search.addEventListener('input', () => {
    query = search.value;
    renderList();
  });
  const promptList = h('div', { class: 'pm-list__items' });
  const listPane = h(
    'div',
    { class: 'pm-list' },
    h(
      'div',
      { class: 'pm-list__toolbar' },
      search,
      button('+ 新規', () => void startNew(), { variant: 'primary', size: 'small' }),
    ),
    promptList,
  );

  const nameInput = h('input', { type: 'text', class: 'cs-input', maxLength: MAX_NAME_LENGTH });
  const category = suggestInput({
    value: '',
    suggestions: [],
    placeholder: UNCATEGORIZED_LABEL,
    maxLength: MAX_CATEGORY_LENGTH,
  });
  const textarea = h('textarea', { class: 'cs-textarea pm-editor__text' });
  const editorTitle = h('span', { class: 'pm-editor__title' });
  const dirtyBadge = h('span', { class: 'pm-editor__dirty', text: '未保存' });
  const deleteBtn = button('削除', () => void remove(), { size: 'dialog' });
  const duplicateBtn = button('複製', () => void duplicate(), { size: 'dialog' });
  const discardBtn = button('破棄', () => closeEditor(), { variant: 'outline', size: 'dialog' });
  const saveBtn = button('保存', () => void save(), { variant: 'primary', size: 'dialog', title: '保存 (Ctrl+S)' });
  const editorForm = h(
    'div',
    { class: 'pm-editor__form' },
    h('div', { class: 'pm-editor__header' }, editorTitle, dirtyBadge),
    field('名前', nameInput),
    field('カテゴリー', category.el),
    h(
      'div',
      { class: 'cs-field pm-editor__text-field' },
      h('label', { class: 'cs-field__label', text: '本文' }),
      textarea,
    ),
    h('div', { class: 'pm-editor__actions' }, deleteBtn, duplicateBtn, discardBtn, saveBtn),
  );
  const editorEmpty = h('div', {
    class: 'pm-editor__empty',
    text: 'プロンプトを選ぶか「+ 新規」で作成してください。',
  });
  const editorPane = h('div', { class: 'pm-editor' }, editorEmpty, editorForm);
  const main = h('main', { class: 'pm-main' }, listPane, editorPane);

  for (const input of [nameInput, category.input, textarea]) input.addEventListener('input', () => renderDirty());

  // ── Store ──
  const prompt = (id: string | null) => store.prompts.find(p => p.id === id);

  /** Reads the file again and redraws the lists (the editor keeps its contents). */
  async function load(): Promise<void> {
    try {
      const { warnings, ...loaded } = await listPrompts();
      showWarnings(warnings);
      store = loaded;
    } catch (err) {
      showError('登録したプロンプトを読み込めませんでした', err);
    }
    if (filter !== null && !displayCategories(store).includes(filter)) filter = null;
    category.setSuggestions(store.categories);
    renderCategories();
    renderList();
  }

  /** Runs a change and reloads; resolves the change's result, or null after an error toast. */
  async function change<T extends { warnings: string[] }>(run: () => Promise<T>, failure: string): Promise<T | null> {
    try {
      const result = await run();
      showWarnings(result.warnings);
      return result;
    } catch (err) {
      showError(failure, err);
      return null;
    } finally {
      await load();
    }
  }

  // ── Categories ──
  /** The category rows with their filter values (すべて = null). */
  const categoryRows = new Map<HTMLElement, CategoryFilter>();

  /** Changes the filter without rebuilding the rows (so a double click on a row still renames it). */
  function selectFilter(value: CategoryFilter): void {
    filter = value;
    for (const [el, rowValue] of categoryRows) el.classList.toggle('pm-category--active', rowValue === value);
    renderList();
  }

  function renderCategories(): void {
    const counts = countByCategory(store);
    categoryRows.clear();
    const row = (value: CategoryFilter) => {
      const named = value !== null && value !== '';
      const label = value === null ? 'すべて' : categoryLabel(value);
      const name = h('span', { class: 'pm-category__name', text: label, title: label });
      const el = h(
        'div',
        {
          class: `pm-category${filter === value ? ' pm-category--active' : ''}`,
          draggable: named,
          dataset: value === null ? {} : { category: value },
          onclick: () => selectFilter(value),
        },
        name,
        named
          ? h(
              'button',
              {
                class: 'pm-category__edit',
                title: '名前を変更',
                onclick: e => {
                  e.stopPropagation();
                  startRename(el, name, value);
                },
              },
              icon('edit', 14),
            )
          : null,
        h('span', {
          class: 'pm-category__count',
          text: String(value === null ? store.prompts.length : (counts.get(value) ?? 0)),
        }),
      );
      if (named) el.addEventListener('dblclick', () => startRename(el, name, value));
      if (value !== null) acceptPromptDrop(el, value);
      categoryRows.set(el, value);
      return el;
    };
    categoryList.replaceChildren(row(null), ...displayCategories(store).map(row));
  }

  /** Dropping a prompt row on a category moves the prompt to the end of that category. */
  function acceptPromptDrop(el: HTMLElement, target: string): void {
    const hasPrompt = (e: DragEvent) => !!e.dataTransfer?.types.includes(PROMPT_MIME);
    el.addEventListener('dragover', e => {
      if (!hasPrompt(e)) return;
      e.preventDefault();
      el.classList.add('pm-category--drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('pm-category--drop'));
    el.addEventListener('drop', e => {
      el.classList.remove('pm-category--drop');
      if (!hasPrompt(e)) return;
      e.preventDefault();
      const moved = prompt(e.dataTransfer?.getData(PROMPT_MIME) ?? '');
      if (moved && moved.category !== target) void moveTo(moved, target);
    });
  }

  async function moveTo(moved: SavedPrompt, target: string): Promise<void> {
    const result = await change(() => movePrompt(moved.id, target), 'プロンプトを移動できませんでした');
    if (!result) return;
    showToast(`プロンプト「${moved.name}」を「${categoryLabel(target)}」に移しました`, 'success');
    if (editing?.id === moved.id) {
      editing.saved.category = target;
      category.input.value = target;
      renderDirty();
    }
  }

  enableDragSort(categoryList, '.pm-category[draggable="true"]', items => {
    const order = items.map(el => el.dataset.category ?? '');
    void change(() => reorderCategories(order), 'カテゴリーを並べ替えられませんでした');
  });

  function startRename(row: HTMLElement, label: HTMLElement, old: string): void {
    if (row.querySelector('.pm-category__input')) return;
    const input = h('input', {
      type: 'text',
      class: 'cs-input pm-category__input',
      value: old,
      maxLength: MAX_CATEGORY_LENGTH,
    });
    row.draggable = false;
    label.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      if (commit) void rename(old, normalizeCategory(input.value));
      else renderCategories();
    };
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        // Without preventDefault the key would also press the confirmation dialog's button that opens now.
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  async function rename(old: string, next: string): Promise<void> {
    if (next === old) {
      renderCategories();
      return;
    }
    if (next === '' || store.categories.includes(next)) {
      const count = countByCategory(store).get(old) ?? 0;
      const ok = await confirmDialog(
        next === ''
          ? {
              title: 'カテゴリーの変更',
              message: `「${old}」のプロンプト ${count} 件を「${UNCATEGORIZED_LABEL}」に移しますか？`,
              confirmLabel: '移す',
            }
          : {
              title: 'カテゴリーの統合',
              message: `「${old}」のプロンプト ${count} 件を「${next}」にまとめますか？`,
              confirmLabel: 'まとめる',
            },
      );
      if (!ok) {
        renderCategories();
        return;
      }
    }
    const wasShown = filter === old;
    const result = await change(() => renameCategory(old, next), 'カテゴリーの名前を変更できませんでした');
    if (!result) return;
    if (wasShown) filter = next;
    if (editing?.saved.category === old) {
      editing.saved.category = next;
      if (normalizeCategory(category.input.value) === old) category.input.value = next;
      renderDirty();
    }
    renderCategories();
    renderList();
    showToast(`カテゴリー「${old}」を「${categoryLabel(next)}」に変更しました`, 'success');
  }

  // ── Prompt list ──
  function renderList(): void {
    const sortable = isSortable(filter, query);
    const groups = groupPrompts(store, filter, query);
    const item = (p: SavedPrompt) => {
      const el = h(
        'div',
        {
          class: `pm-prompt${sortable ? ' pm-prompt--sortable' : ''}${editing?.id === p.id ? ' pm-prompt--active' : ''}`,
          draggable: true,
          title: p.text,
          dataset: { id: p.id },
          onclick: () => void open(p),
        },
        sortable ? icon('drag_indicator', 14) : null,
        h('span', { class: 'pm-prompt__name', text: p.name }),
      );
      el.addEventListener('dragstart', e => e.dataTransfer?.setData(PROMPT_MIME, p.id));
      return el;
    };
    const empty = (text: string) => promptList.replaceChildren(h('div', { class: 'pm-list__empty', text }));
    if (store.prompts.length === 0) empty('登録されたプロンプトはありません。「+ 新規」から作成できます。');
    else if (groups.length === 0) empty('条件に合うプロンプトはありません。');
    else {
      promptList.replaceChildren(
        ...groups
          .flatMap(g => [
            filter === null ? h('div', { class: 'pm-list__group', text: categoryLabel(g.category) }) : null,
            ...g.prompts.map(item),
          ])
          .filter((el): el is HTMLDivElement => el !== null),
      );
    }
  }

  enableDragSort(promptList, '.pm-prompt--sortable', items => {
    if (filter === null) return;
    const target = filter;
    const ids = items.map(el => el.dataset.id ?? '');
    void change(() => reorderPrompts(target, ids), 'プロンプトを並べ替えられませんでした');
  });

  // ── Editor ──
  const currentFields = (): PromptFields => ({
    name: nameInput.value,
    category: normalizeCategory(category.input.value),
    text: textarea.value,
  });

  function isDirty(): boolean {
    if (!editing) return false;
    const now = currentFields();
    return (
      now.name !== editing.saved.name || now.category !== editing.saved.category || now.text !== editing.saved.text
    );
  }

  function renderDirty(): void {
    setShown(dirtyBadge, isDirty());
  }

  function renderEditor(): void {
    setShown(editorEmpty, !editing);
    setShown(editorForm, !!editing, 'flex');
    if (editing) {
      const isNew = editing.id === null;
      editorTitle.textContent = isNew ? '新しいプロンプト' : 'プロンプトを編集';
      setShown(deleteBtn, !isNew);
      setShown(duplicateBtn, !isNew);
      setShown(discardBtn, isNew);
    }
    renderDirty();
    renderList();
  }

  function fillEditor(id: string | null, fields: PromptFields): void {
    editing = { id, saved: { ...fields } };
    nameInput.value = fields.name;
    category.input.value = fields.category;
    textarea.value = fields.text;
    renderEditor();
  }

  function closeEditor(): void {
    editing = null;
    renderEditor();
  }

  /** Before the editor is replaced: true to go on (saved or discarded), false to stay. */
  async function confirmLeave(): Promise<boolean> {
    if (!editing || !isDirty()) return true;
    const name = nameInput.value.trim() || editing.saved.name || '新しいプロンプト';
    const choice = await choiceDialog({
      title: '未保存の変更',
      message: `「${name}」の変更が保存されていません。`,
      choices: [
        { value: 'discard', label: '破棄' },
        { value: 'save', label: '保存', variant: 'primary' },
      ],
    });
    if (choice === 'save') return save();
    return choice === 'discard';
  }

  async function open(p: SavedPrompt): Promise<void> {
    if (editing?.id === p.id || !(await confirmLeave())) return;
    fillEditor(p.id, p);
    nameInput.focus();
  }

  async function startNew(): Promise<void> {
    if (!(await confirmLeave())) return;
    fillEditor(null, { name: '', category: filter ?? '', text: '' });
    nameInput.focus();
  }

  /** Saves the editor; resolves true when saved. */
  async function save(): Promise<boolean> {
    if (!editing || saving) return false;
    const fields = currentFields();
    const error = promptInputError(fields.name, fields.category, fields.text);
    if (error) {
      showToast(error, 'warning');
      return false;
    }
    const name = fields.name.trim();
    if (findByName(store.prompts, name, editing.id ?? undefined)) {
      showToast(`同じ名前のプロンプト「${name}」が登録されています。`, 'warning');
      return false;
    }
    saving = true;
    saveBtn.disabled = true;
    try {
      const id = editing.id;
      const result = await change(
        () =>
          id === null
            ? createPrompt(name, fields.category, fields.text)
            : updatePrompt(id, name, fields.category, fields.text),
        'プロンプトを保存できませんでした',
      );
      if (!result) return false;
      const saved = result.prompt;
      fillEditor(saved.id, saved);
      if (!groupPrompts(store, filter, query).some(g => g.prompts.some(p => p.id === saved.id))) {
        filter = saved.category;
        query = search.value = '';
        renderCategories();
        renderList();
      }
      showToast(`プロンプト「${saved.name}」を${id === null ? '作成' : '保存'}しました`, 'success');
      return true;
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  async function duplicate(): Promise<void> {
    const id = editing?.id;
    if (!id || !(await confirmLeave())) return;
    const result = await change(() => duplicatePrompt(id), 'プロンプトを複製できませんでした');
    if (!result) return;
    fillEditor(result.prompt.id, result.prompt);
    showToast(`プロンプト「${result.prompt.name}」を作成しました`, 'success');
  }

  async function remove(): Promise<void> {
    const id = editing?.id;
    if (!editing || !id) return;
    const name = editing.saved.name;
    const ok = await confirmDialog({
      title: 'プロンプトの削除',
      message: `「${name}」を削除しますか？`,
      confirmLabel: '削除',
    });
    if (!ok) return;
    const result = await change(() => deletePrompt(id), 'プロンプトを削除できませんでした');
    if (!result) return;
    closeEditor();
    showToast(`プロンプト「${name}」を削除しました`, 'success');
  }

  // ── Mode ──
  on('prompt-mode:toggle', ({ enabled }) => {
    if (!enabled) return;
    filter = null;
    query = search.value = '';
    closeEditor();
    void load();
  });
  setLeaveGuard('prompt', confirmLeave);
  // Ctrl+S saves the editor, also while typing in it.
  window.addEventListener(
    'keydown',
    e => {
      if (!isViewMode('prompt') || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      if (editing && !isDialogOpen()) void save();
    },
    true,
  );

  renderEditor();
  return { sidebar, main };
}
