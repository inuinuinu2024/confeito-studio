/**
 * Character Manager (docs/specs/character-manager.md) — the "character" view mode. Works like the Prompt
 * Manager: the category sidebar takes the place of ARCHIVES and the main area (character list | editor)
 * the place of the canvas; app.ts shows them while the mode is on. Every change is saved to the backend
 * at once, except the editor (fields, images and icon), which saves with 保存 / Ctrl+S and asks before unsaved
 * changes are left. The icon is cut from one of the images in the icon cropper (icon-cropper.ts).
 */
import './character-manager.css';
import {
  type CharacterFields,
  type CharacterStore,
  characterIconUrl,
  createCharacter,
  deleteCharacter,
  duplicateCharacter,
  listCharacters,
  moveCharacter,
  renameCharacterCategory,
  reorderCharacterCategories,
  reorderCharacters,
  type SavedCharacter,
  updateCharacter,
} from '../../shared/api/characters';
import { on } from '../../shared/events';
import { isViewMode, setLeaveGuard } from '../../shared/state/view-mode';
import { createCategorySidebar } from '../../shared/ui/category-sidebar';
import { choiceDialog, confirmDialog } from '../../shared/ui/dialogs';
import { enableDragSort } from '../../shared/ui/drag-sort';
import { h, icon as materialIcon, setShown } from '../../shared/ui/dom';
import { button, field, suggestInput } from '../../shared/ui/form';
import { showError, showToast } from '../../shared/ui/toast';
import {
  type CategoryFilter,
  categoryLabel,
  countByCategory,
  displayCategories,
  findByName,
  isSortable,
  MAX_CATEGORY_LENGTH,
  MAX_NAME_LENGTH,
  nameCategoryError,
  normalizeCategory,
  UNCATEGORIZED_LABEL,
} from '../../shared/utils/categories';
import {
  type EditorIcon,
  type EditorImage,
  groupCharacters,
  sameIcon,
  sameImages,
} from '../../shared/utils/characters';
import { openIconCropper } from './icon-cropper';
import { createImageList } from './image-list';
import { chooseImportFile, exportAll } from './transfer';

/** dataTransfer type of a character dragged onto a category. */
const CHARACTER_MIME = 'application/x-confeito-character';

interface EditorFields {
  name: string;
  category: string;
  text: string;
  images: EditorImage[];
  icon: EditorIcon;
}

/** The character open in the editor: `id` null for a new one not saved yet; `saved` is what 保存 last wrote. */
interface Editing {
  id: string | null;
  saved: EditorFields;
}

const isDialogOpen = () => !!document.querySelector('.cs-modal-overlay--open, dialog[open]');

function showWarnings(warnings: string[]): void {
  for (const warning of warnings) showToast(warning, 'warning');
}

const savedFields = (c: SavedCharacter): EditorFields => ({
  name: c.name,
  category: c.category,
  text: c.text,
  images: c.images.map(saved => ({ saved })),
  icon: c.icon ? { saved: c.icon } : null,
});

export function createCharacterManager(): { sidebar: HTMLElement; main: HTMLElement } {
  let store: CharacterStore = { categories: [], characters: [] };
  let filter: CategoryFilter = null;
  let query = '';
  let editing: Editing | null = null;
  let saving = false;

  // ── Sidebar: categories ──
  const categorySidebar = createCategorySidebar({
    title: 'CHARACTERS',
    className: 'mgr-sidebar--character',
    itemNoun: 'キャラクター',
    itemMime: CHARACTER_MIME,
    actions: [
      { icon: 'refresh', title: '再読み込み', onClick: () => void load() },
      {
        icon: 'upload',
        title: 'インポート',
        onClick: () => void chooseImportFile().then(changed => (changed ? load() : undefined)),
      },
      { icon: 'download', title: 'エクスポート', onClick: () => void exportAll() },
    ],
    onSelect: value => {
      filter = value;
      renderList();
    },
    onReorder: order => void change(() => reorderCharacterCategories(order), 'カテゴリーを並べ替えられませんでした'),
    onDropItem: (id, target) => {
      const moved = character(id);
      if (moved && moved.category !== target) void moveTo(moved, target);
    },
    onRename: (old, next) => void rename(old, next),
  });

  // ── Main: character list | editor ──
  const search = h('input', { type: 'search', class: 'cs-input mgr-list__search', placeholder: '名前・本文で検索' });
  search.addEventListener('input', () => {
    query = search.value;
    renderList();
  });
  const characterList = h('div', { class: 'mgr-list__items' });
  const listPane = h(
    'div',
    { class: 'mgr-list' },
    h(
      'div',
      { class: 'mgr-list__toolbar' },
      search,
      button('+ 新規', () => void startNew(), { variant: 'primary', size: 'small' }),
    ),
    characterList,
  );

  const nameInput = h('input', { type: 'text', class: 'cs-input', maxLength: MAX_NAME_LENGTH });
  const category = suggestInput({
    value: '',
    suggestions: [],
    placeholder: UNCATEGORIZED_LABEL,
    maxLength: MAX_CATEGORY_LENGTH,
  });
  const textarea = h('textarea', {
    class: 'cs-textarea cm-editor__text',
    placeholder: 'キャラクターの特徴など（任意）。ツールで使うと最初の画像の説明に入ります。',
  });
  const imageList = createImageList(
    () => {
      renderDirty();
      renderIcon();
    },
    // A character without an icon gets one from the first image added (docs/specs/character-manager.md 「アイコン」).
    firstIndex => {
      if (editing && !icon) void createIcon(firstIndex);
    },
  );
  /** The icon in the editor (unsaved until 保存), and the object URL showing a new one. */
  let icon: EditorIcon = null;
  let iconUrl: string | null = null;
  const iconPreview = h('div', { class: 'cm-icon__preview' });
  const iconCreateBtn = button('アイコンを作成', () => void createIcon(0), { size: 'small' });
  const iconRemoveBtn = button(
    '外す',
    () => {
      icon = null;
      renderIcon();
      renderDirty();
    },
    { variant: 'outline', size: 'small' },
  );
  const iconField = h(
    'div',
    { class: 'cs-field cm-icon' },
    h('label', { class: 'cs-field__label', text: 'アイコン' }),
    h('div', { class: 'cm-icon__row' }, iconPreview, iconCreateBtn, iconRemoveBtn),
  );
  const editorTitle = h('span', { class: 'mgr-editor__title' });
  const dirtyBadge = h('span', { class: 'mgr-editor__dirty', text: '未保存' });
  const deleteBtn = button('削除', () => void remove(), { size: 'dialog' });
  const duplicateBtn = button('複製', () => void duplicate(), { size: 'dialog' });
  const discardBtn = button('破棄', () => closeEditor(), { variant: 'outline', size: 'dialog' });
  const saveBtn = button('保存', () => void save(), { variant: 'primary', size: 'dialog', title: '保存 (Ctrl+S)' });
  const editorForm = h(
    'div',
    { class: 'mgr-editor__form' },
    h('div', { class: 'mgr-editor__header' }, editorTitle, dirtyBadge),
    h(
      'div',
      { class: 'cm-editor__body' },
      field('名前', nameInput),
      field('カテゴリー', category.el),
      field('プロンプト本文', textarea),
      iconField,
      imageList.el,
    ),
    h('div', { class: 'mgr-editor__actions' }, deleteBtn, duplicateBtn, discardBtn, saveBtn),
  );
  const editorEmpty = h('div', {
    class: 'mgr-editor__empty',
    text: 'キャラクターを選ぶか「+ 新規」で作成してください。',
  });
  const editorPane = h('div', { class: 'mgr-editor' }, editorEmpty, editorForm);
  const main = h('main', { class: 'mgr-main mgr-main--character' }, listPane, editorPane);

  for (const input of [nameInput, category.input, textarea]) input.addEventListener('input', () => renderDirty());

  // ── Store ──
  const character = (id: string | null) => store.characters.find(c => c.id === id);

  /** Reads the file again and redraws the lists (the editor keeps its contents). */
  async function load(): Promise<void> {
    try {
      const { warnings, ...loaded } = await listCharacters();
      showWarnings(warnings);
      store = loaded;
    } catch (err) {
      showError('登録したキャラクターを読み込めませんでした', err);
    }
    if (filter !== null && !displayCategories(store.categories, store.characters).includes(filter)) filter = null;
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
  function renderCategories(): void {
    categorySidebar.render({
      categories: displayCategories(store.categories, store.characters),
      counts: countByCategory(store.characters),
      total: store.characters.length,
      filter,
    });
  }

  async function moveTo(moved: SavedCharacter, target: string): Promise<void> {
    const result = await change(() => moveCharacter(moved.id, target), 'キャラクターを移動できませんでした');
    if (!result) return;
    showToast(`キャラクター「${moved.name}」を「${categoryLabel(target)}」に移しました`, 'success');
    if (editing?.id === moved.id) {
      editing.saved.category = target;
      category.input.value = target;
      renderDirty();
    }
  }

  /** Renames a category (the sidebar asked for the confirmation of a merge). */
  async function rename(old: string, next: string): Promise<void> {
    const wasShown = filter === old;
    const result = await change(() => renameCharacterCategory(old, next), 'カテゴリーの名前を変更できませんでした');
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

  // ── Character list ──
  function renderList(): void {
    const sortable = isSortable(filter, query);
    const groups = groupCharacters(store, filter, query);
    const item = (c: SavedCharacter) => {
      const el = h(
        'div',
        {
          class: `mgr-item${sortable ? ' mgr-item--sortable' : ''}${editing?.id === c.id ? ' mgr-item--active' : ''}`,
          draggable: true,
          title: c.text || c.name,
          dataset: { id: c.id },
          onclick: () => void open(c),
        },
        sortable ? materialIcon('drag_indicator', 14) : null,
        c.icon
          ? h('img', { class: 'cm-thumb', src: characterIconUrl(c.id, c.icon), alt: '', draggable: false })
          : h('span', { class: 'cm-thumb cm-thumb--empty' }, materialIcon('person', 36)),
        h('span', { class: 'mgr-item__name', text: c.name }),
      );
      el.addEventListener('dragstart', e => e.dataTransfer?.setData(CHARACTER_MIME, c.id));
      return el;
    };
    const empty = (text: string) => characterList.replaceChildren(h('div', { class: 'mgr-list__empty', text }));
    if (store.characters.length === 0) empty('登録されたキャラクターはありません。「+ 新規」から作成できます。');
    else if (groups.length === 0) empty('条件に合うキャラクターはありません。');
    else {
      characterList.replaceChildren(
        ...groups
          .flatMap(g => [
            filter === null ? h('div', { class: 'mgr-list__group', text: categoryLabel(g.category) }) : null,
            ...g.items.map(item),
          ])
          .filter((el): el is HTMLDivElement => el !== null),
      );
    }
  }

  enableDragSort(characterList, '.mgr-item--sortable', items => {
    if (filter === null) return;
    const target = filter;
    const ids = items.map(el => el.dataset.id ?? '');
    void change(() => reorderCharacters(target, ids), 'キャラクターを並べ替えられませんでした');
  });

  // ── Editor ──
  const currentFields = (): EditorFields => ({
    name: nameInput.value,
    category: normalizeCategory(category.input.value),
    text: textarea.value,
    images: imageList.get(),
    icon,
  });

  function isDirty(): boolean {
    if (!editing) return false;
    const now = currentFields();
    const saved = editing.saved;
    return (
      now.name !== saved.name ||
      now.category !== saved.category ||
      now.text !== saved.text ||
      !sameImages(now.images, saved.images) ||
      !sameIcon(now.icon, saved.icon)
    );
  }

  function renderDirty(): void {
    setShown(dirtyBadge, isDirty());
  }

  function renderIcon(): void {
    if (iconUrl && !(icon && 'blob' in icon)) {
      URL.revokeObjectURL(iconUrl);
      iconUrl = null;
    }
    let src: string | null = null;
    if (icon && 'saved' in icon) src = characterIconUrl(editing?.id ?? '', icon.saved);
    else if (icon) src = iconUrl ??= URL.createObjectURL(icon.blob);
    iconPreview.replaceChildren(
      src ? h('img', { src, alt: 'アイコン', draggable: false }) : materialIcon('person', 32),
    );
    const hasImages = imageList.get().length > 0;
    iconCreateBtn.textContent = icon ? 'アイコンを変更' : 'アイコンを作成';
    iconCreateBtn.disabled = !hasImages;
    iconCreateBtn.title = hasImages ? '' : '画像を追加すると作成できます';
    setShown(iconRemoveBtn, !!icon);
  }

  /** Opens the icon cropper on the editor's images (starting with `index`); its result becomes the icon. */
  async function createIcon(index: number): Promise<void> {
    const sources = imageList.sources();
    if (!sources.length) return;
    const blob = await openIconCropper(sources, index);
    if (!blob || !editing) return;
    if (iconUrl) URL.revokeObjectURL(iconUrl);
    iconUrl = null;
    icon = { blob };
    renderIcon();
    renderDirty();
  }

  function renderEditor(): void {
    setShown(editorEmpty, !editing);
    setShown(editorForm, !!editing, 'flex');
    if (editing) {
      const isNew = editing.id === null;
      editorTitle.textContent = isNew ? '新しいキャラクター' : 'キャラクターを編集';
      setShown(deleteBtn, !isNew);
      setShown(duplicateBtn, !isNew);
      setShown(discardBtn, isNew);
    }
    renderDirty();
    renderList();
  }

  function fillEditor(id: string | null, fields: EditorFields): void {
    editing = { id, saved: { ...fields, images: [...fields.images] } };
    nameInput.value = fields.name;
    category.input.value = fields.category;
    textarea.value = fields.text;
    imageList.set(id, fields.images);
    icon = fields.icon;
    renderIcon();
    renderEditor();
  }

  function closeEditor(): void {
    editing = null;
    imageList.set(null, []);
    icon = null;
    renderIcon();
    renderEditor();
  }

  /** Before the editor is replaced: true to go on (saved or discarded), false to stay. */
  async function confirmLeave(): Promise<boolean> {
    if (!editing || !isDirty()) return true;
    const name = nameInput.value.trim() || editing.saved.name || '新しいキャラクター';
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

  async function open(c: SavedCharacter): Promise<void> {
    if (editing?.id === c.id || !(await confirmLeave())) return;
    fillEditor(c.id, savedFields(c));
    nameInput.focus();
  }

  async function startNew(): Promise<void> {
    if (!(await confirmLeave())) return;
    fillEditor(null, { name: '', category: filter ?? '', text: '', images: [], icon: null });
    nameInput.focus();
  }

  /** Saves the editor; resolves true when saved. */
  async function save(): Promise<boolean> {
    if (!editing || saving) return false;
    const fields = currentFields();
    const error = nameCategoryError(fields.name, fields.category);
    if (error) {
      showToast(error, 'warning');
      return false;
    }
    const name = fields.name.trim();
    if (findByName(store.characters, name, editing.id ?? undefined)) {
      showToast(`同じ名前のキャラクター「${name}」が登録されています。`, 'warning');
      return false;
    }
    const request: CharacterFields = {
      name,
      category: fields.category,
      text: fields.text,
      images: fields.images.map(image =>
        'saved' in image ? { file: image.saved } : { blob: image.file, name: image.file.name },
      ),
      icon: fields.icon === null ? 'none' : 'saved' in fields.icon ? 'keep' : fields.icon.blob,
    };
    saving = true;
    saveBtn.disabled = true;
    try {
      const id = editing.id;
      const result = await change(
        () => (id === null ? createCharacter(request) : updateCharacter(id, request)),
        'キャラクターを保存できませんでした',
      );
      if (!result) return false;
      const saved = result.character;
      fillEditor(saved.id, savedFields(saved));
      if (!groupCharacters(store, filter, query).some(g => g.items.some(c => c.id === saved.id))) {
        filter = saved.category;
        query = search.value = '';
        renderCategories();
        renderList();
      }
      showToast(`キャラクター「${saved.name}」を${id === null ? '作成' : '保存'}しました`, 'success');
      return true;
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  async function duplicate(): Promise<void> {
    const id = editing?.id;
    if (!id || !(await confirmLeave())) return;
    const result = await change(() => duplicateCharacter(id), 'キャラクターを複製できませんでした');
    if (!result) return;
    fillEditor(result.character.id, savedFields(result.character));
    showToast(`キャラクター「${result.character.name}」を作成しました`, 'success');
  }

  async function remove(): Promise<void> {
    const id = editing?.id;
    if (!editing || !id) return;
    const { name, images } = editing.saved;
    const ok = await confirmDialog({
      title: 'キャラクターの削除',
      message: `「${name}」を削除しますか？${images.length ? `画像 ${images.length} 枚も削除されます。` : ''}`,
      confirmLabel: '削除',
    });
    if (!ok) return;
    const result = await change(() => deleteCharacter(id), 'キャラクターを削除できませんでした');
    if (!result) return;
    closeEditor();
    showToast(`キャラクター「${name}」を削除しました`, 'success');
  }

  // ── Mode ──
  on('character-mode:toggle', ({ enabled }) => {
    if (!enabled) return;
    filter = null;
    query = search.value = '';
    closeEditor();
    void load();
  });
  setLeaveGuard('character', confirmLeave);
  // Ctrl+S saves the editor, also while typing in it.
  window.addEventListener(
    'keydown',
    e => {
      if (!isViewMode('character') || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      if (editing && !isDialogOpen()) void save();
    },
    true,
  );

  renderEditor();
  return { sidebar: categorySidebar.el, main };
}
