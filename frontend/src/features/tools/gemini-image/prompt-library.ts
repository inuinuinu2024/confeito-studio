/**
 * Registered prompts from a tool (docs/specs/tools/gemini-image.md 「プロンプト」): the register dialog
 * and the picker (category filter + search + 使う). The prompts are shared by every tool and managed
 * (edit / delete / order) in the Prompt Manager (docs/specs/prompt-manager.md).
 */
import { createPrompt, listPrompts, type PromptStore, updatePrompt } from '../../../shared/api/prompts';
import { confirmDialog } from '../../../shared/ui/dialogs';
import { h } from '../../../shared/ui/dom';
import { button, field, select, suggestInput } from '../../../shared/ui/form';
import { showError, showToast } from '../../../shared/ui/toast';
import { openWindow } from '../../../shared/ui/window';
import {
  type CategoryFilter,
  categoryLabel,
  displayCategories,
  findByName,
  groupPrompts,
  MAX_CATEGORY_LENGTH,
  MAX_NAME_LENGTH,
  normalizeCategory,
  previewText,
  promptInputError,
  UNCATEGORIZED_LABEL,
} from '../../../shared/utils/prompts';
import './prompt-library.css';

/** Class of the prompt windows (size: prompt-library.css; the character picker uses it too). */
const WINDOW_CLASS = 'prompt-dialog';
/** The <select> value for すべて (category names are never empty-with-a-marker like this). */
const ALL = '\u0000all';

/** Every prompt (warnings as toasts), or null after an error toast. */
async function fetchStore(): Promise<PromptStore | null> {
  try {
    const { warnings, ...store } = await listPrompts();
    for (const warning of warnings) showToast(warning, 'warning');
    return store;
  } catch (err) {
    showError('登録したプロンプトを読み込めませんでした', err);
    return null;
  }
}

/** Runs a change; resolves true after the success toast, false after the error toast. */
async function saveChange(change: () => Promise<{ warnings: string[] }>, success: string, failure: string) {
  try {
    const { warnings } = await change();
    for (const warning of warnings) showToast(warning, 'warning');
    showToast(success, 'success');
    return true;
  } catch (err) {
    showError(failure, err);
    return false;
  }
}

/** Registers `text` under a new name; a name already registered is overwritten after a confirmation. */
export function openRegisterDialog(text: string): void {
  const nameInput = h('input', {
    type: 'text',
    class: 'cs-input',
    maxLength: MAX_NAME_LENGTH,
    placeholder: '例: 着彩（線画を維持）',
  });
  const category = suggestInput({
    value: '',
    suggestions: [],
    placeholder: UNCATEGORIZED_LABEL,
    maxLength: MAX_CATEGORY_LENGTH,
  });
  const textarea = h('textarea', { class: 'cs-textarea prompt-editor__text', value: text });
  const win = openWindow({ title: 'プロンプトを登録', className: WINDOW_CLASS });
  const dispose = win.close;
  void fetchStore().then(store => store && category.setSuggestions(store.categories));

  const register = async (): Promise<boolean> => {
    const name = nameInput.value.trim();
    const categoryName = normalizeCategory(category.input.value);
    const store = await fetchStore();
    if (!store) return false;
    const existing = findByName(store.prompts, name);
    if (!existing) {
      return saveChange(
        () => createPrompt(name, categoryName, textarea.value),
        `プロンプト「${name}」を登録しました`,
        'プロンプトを登録できませんでした',
      );
    }
    const overwrite = await confirmDialog({
      title: 'プロンプトの上書き',
      message: `「${name}」はすでに登録されています。上書きしますか？`,
      confirmLabel: '上書き',
    });
    if (!overwrite) return false;
    return saveChange(
      () => updatePrompt(existing.id, name, categoryName, textarea.value),
      `プロンプト「${name}」を上書きしました`,
      'プロンプトを上書きできませんでした',
    );
  };

  const save = button(
    '登録',
    async () => {
      const error = promptInputError(nameInput.value, category.input.value, textarea.value);
      if (error) {
        showToast(error, 'warning');
        return;
      }
      save.disabled = true;
      try {
        if (await register()) dispose();
      } finally {
        save.disabled = false;
      }
    },
    { variant: 'primary', size: 'dialog' },
  );
  win.body.append(field('名前', nameInput), field('カテゴリー', category.el), field('本文', textarea));
  win.footer(save);
  nameInput.focus();
}

/** The registered prompts to choose from; 使う passes the text to `onUse` and closes the picker. */
export function openPromptPicker(onUse: (text: string) => void): void {
  const win = openWindow({ title: '登録したプロンプト', className: WINDOW_CLASS });
  const dispose = win.close;
  const list = h('div', { class: 'prompt-library' }, h('div', { class: 'prompt-library__empty', text: '読み込み中…' }));
  const filters = h('div', { class: 'prompt-library__filters' });
  let store: PromptStore | null = null;
  let filter: CategoryFilter = null;
  let query = '';

  const search = h('input', { type: 'search', class: 'cs-input', placeholder: '名前・本文で検索' });
  search.addEventListener('input', () => {
    query = search.value;
    render();
  });

  const item = (prompt: PromptStore['prompts'][number]) =>
    h(
      'div',
      { class: 'prompt-library__item' },
      h(
        'div',
        { class: 'prompt-library__body' },
        h(
          'div',
          { class: 'prompt-library__head' },
          h('span', { class: 'prompt-library__name', text: prompt.name }),
          h('span', { class: 'prompt-library__category', text: categoryLabel(prompt.category) }),
        ),
        h('div', { class: 'prompt-library__preview', text: previewText(prompt.text), title: prompt.text }),
      ),
      button(
        '使う',
        () => {
          dispose();
          onUse(prompt.text);
          showToast(`プロンプト「${prompt.name}」を読み込みました`);
        },
        { variant: 'primary', size: 'small' },
      ),
    );

  const render = () => {
    if (!store) return;
    const empty = (text: string) => list.replaceChildren(h('div', { class: 'prompt-library__empty', text }));
    if (store.prompts.length === 0) {
      empty('登録されたプロンプトはありません。プロンプト欄の「登録」ボタンか Prompt Manager で追加できます。');
      return;
    }
    const prompts = groupPrompts(store, filter, query).flatMap(g => g.prompts);
    if (prompts.length === 0) empty('条件に合うプロンプトはありません。');
    else list.replaceChildren(...prompts.map(item));
  };

  win.body.append(
    filters,
    list,
    h('div', {
      class: 'prompt-library__hint',
      text: '編集・削除・並べ替えは Prompt Manager（左端のアイコン）で行えます。',
    }),
  );
  search.focus();

  void fetchStore().then(loaded => {
    if (!win.overlay.isConnected) return;
    if (!loaded) {
      list.replaceChildren(h('div', { class: 'prompt-library__empty', text: '読み込めませんでした。' }));
      return;
    }
    store = loaded;
    const categories = select(
      [{ value: ALL, label: 'すべて' }, ...displayCategories(loaded).map(c => ({ value: c, label: categoryLabel(c) }))],
      ALL,
      value => {
        filter = value === ALL ? null : value;
        render();
      },
    );
    categories.classList.add('prompt-library__category-select');
    filters.replaceChildren(categories, search);
    render();
  });
}
