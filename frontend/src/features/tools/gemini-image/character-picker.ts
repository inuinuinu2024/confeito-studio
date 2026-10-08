/**
 * Registered characters from a tool (docs/specs/tools/gemini-image.md 「登録したキャラクター」): the picker
 * (category filter + search + 使う). The characters are shared by every tool and managed in the Character
 * Manager (docs/specs/character-manager.md). Looks like the prompt picker (prompt-library.css).
 */
import {
  type CharacterStore,
  characterIconUrl,
  listCharacters,
  type SavedCharacter,
} from '../../../shared/api/characters';
import { h, icon } from '../../../shared/ui/dom';
import { button, select } from '../../../shared/ui/form';
import { showError, showToast } from '../../../shared/ui/toast';
import { openWindow } from '../../../shared/ui/window';
import { type CategoryFilter, categoryLabel, displayCategories, previewText } from '../../../shared/utils/categories';
import { groupCharacters } from '../../../shared/utils/characters';
import './character-picker.css';
import './prompt-library.css';

/** The <select> value for すべて. */
const ALL = '\u0000all';

/** Every character (warnings as toasts), or null after an error toast. */
async function fetchStore(): Promise<CharacterStore | null> {
  try {
    const { warnings, ...store } = await listCharacters();
    for (const warning of warnings) showToast(warning, 'warning');
    return store;
  } catch (err) {
    showError('登録したキャラクターを読み込めませんでした', err);
    return null;
  }
}

/** The registered characters to choose from; 使う passes the character to `onUse` and closes the picker. */
export function openCharacterPicker(onUse: (character: SavedCharacter) => void): void {
  const win = openWindow({ title: '登録したキャラクター', className: 'prompt-dialog' });
  const dispose = win.close;
  const list = h('div', { class: 'prompt-library' }, h('div', { class: 'prompt-library__empty', text: '読み込み中…' }));
  const filters = h('div', { class: 'prompt-library__filters' });
  let store: CharacterStore | null = null;
  let filter: CategoryFilter = null;
  let query = '';

  const search = h('input', { type: 'search', class: 'cs-input', placeholder: '名前・本文で検索' });
  search.addEventListener('input', () => {
    query = search.value;
    render();
  });

  const item = (c: SavedCharacter) =>
    h(
      'div',
      { class: 'prompt-library__item character-library__item' },
      c.icon
        ? h('img', { class: 'character-library__thumb', src: characterIconUrl(c.id, c.icon), alt: '' })
        : h('span', { class: 'character-library__thumb character-library__thumb--empty' }, icon('person', 24)),
      h(
        'div',
        { class: 'prompt-library__body' },
        h(
          'div',
          { class: 'prompt-library__head' },
          h('span', { class: 'prompt-library__name', text: c.name }),
          h('span', { class: 'prompt-library__category', text: categoryLabel(c.category) }),
          h('span', { class: 'character-library__count', text: `画像 ${c.images.length} 枚` }),
        ),
        c.text.trim() ? h('div', { class: 'prompt-library__preview', text: previewText(c.text), title: c.text }) : null,
      ),
      button(
        '使う',
        () => {
          dispose();
          onUse(c);
        },
        { variant: 'primary', size: 'small' },
      ),
    );

  const render = () => {
    if (!store) return;
    const empty = (text: string) => list.replaceChildren(h('div', { class: 'prompt-library__empty', text }));
    if (store.characters.length === 0) {
      empty('登録されたキャラクターはありません。Character Manager（左端のアイコン）で追加できます。');
      return;
    }
    const characters = groupCharacters(store, filter, query).flatMap(g => g.items);
    if (characters.length === 0) empty('条件に合うキャラクターはありません。');
    else list.replaceChildren(...characters.map(item));
  };

  win.body.append(
    filters,
    list,
    h('div', {
      class: 'prompt-library__hint',
      text: '画像はキャラクター一貫性 (Character) の参照画像として追加されます。編集は Character Manager（左端のアイコン）で行えます。',
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
      [
        { value: ALL, label: 'すべて' },
        ...displayCategories(loaded.categories, loaded.characters).map(c => ({ value: c, label: categoryLabel(c) })),
      ],
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
