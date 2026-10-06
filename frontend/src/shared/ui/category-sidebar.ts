/**
 * Category sidebar of the managers (Prompt Manager, Character Manager; styles: shared/styles/manager.css).
 * The managers' sidebar column: a header with action buttons, then すべて / the categories / 未分類 with
 * counts. A click filters, a double click (or the pencil) renames a category in place (merging into an
 * existing one or into 未分類 after a confirmation), rows are reordered by dragging, and item rows
 * dragged with `itemMime` can be dropped on a category.
 */
import '../styles/manager.css';
import {
  type CategoryFilter,
  categoryLabel,
  MAX_CATEGORY_LENGTH,
  normalizeCategory,
  UNCATEGORIZED_LABEL,
} from '../utils/categories';
import { confirmDialog } from './dialogs';
import { enableDragSort } from './drag-sort';
import { h, icon } from './dom';
import { createResizer } from './resizer';

export interface CategorySidebarState {
  /** Categories in display order (with "" = 未分類 last when used). */
  categories: string[];
  counts: Map<string, number>;
  total: number;
  filter: CategoryFilter;
}

export interface CategorySidebar {
  el: HTMLElement;
  render(state: CategorySidebarState): void;
}

export function createCategorySidebar(opts: {
  title: string;
  /** Extra class of the root (the manager's mode shows it). */
  className: string;
  /** What an item is called in the confirmations, e.g. "プロンプト". */
  itemNoun: string;
  /** dataTransfer type of an item row dragged onto a category (its data is the item's id). */
  itemMime: string;
  actions: { icon: string; title: string; onClick: () => void }[];
  onSelect(filter: CategoryFilter): void;
  onReorder(categories: string[]): void;
  onDropItem(id: string, category: string): void;
  /** Called after the confirmation (if any) with a name different from the old one ("" = 未分類). */
  onRename(oldName: string, newName: string): void;
}): CategorySidebar {
  let state: CategorySidebarState = { categories: [], counts: new Map(), total: 0, filter: null };
  const el = h('aside', { class: `mgr-sidebar ${opts.className}` });
  const list = h('div', { class: 'mgr-categories' });
  el.append(
    createResizer(el, '--left-sidebar-width', 'right', 'mgr-sidebar__resizer'),
    h(
      'div',
      { class: 'mgr-sidebar__header' },
      h('span', { class: 'mgr-sidebar__title', text: opts.title }),
      h(
        'div',
        { class: 'mgr-sidebar__actions' },
        ...opts.actions.map(a =>
          h('button', { class: 'mgr-sidebar__action-btn', title: a.title, onclick: a.onClick }, icon(a.icon, 16)),
        ),
      ),
    ),
    list,
  );

  /** The rows with their filter values (すべて = null). */
  const rows = new Map<HTMLElement, CategoryFilter>();

  /** Changes the filter without rebuilding the rows (so a double click on a row still renames it). */
  function select(value: CategoryFilter): void {
    state.filter = value;
    for (const [row, rowValue] of rows) row.classList.toggle('mgr-category--active', rowValue === value);
    opts.onSelect(value);
  }

  function render(next: CategorySidebarState = state): void {
    state = next;
    rows.clear();
    const row = (value: CategoryFilter) => {
      const named = value !== null && value !== '';
      const label = value === null ? 'すべて' : categoryLabel(value);
      const name = h('span', { class: 'mgr-category__name', text: label, title: label });
      const el = h(
        'div',
        {
          class: `mgr-category${state.filter === value ? ' mgr-category--active' : ''}`,
          draggable: named,
          dataset: value === null ? {} : { category: value },
          onclick: () => select(value),
        },
        name,
        named
          ? h(
              'button',
              {
                class: 'mgr-category__edit',
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
          class: 'mgr-category__count',
          text: String(value === null ? state.total : (state.counts.get(value) ?? 0)),
        }),
      );
      if (named) el.addEventListener('dblclick', () => startRename(el, name, value));
      if (value !== null) acceptItemDrop(el, value);
      rows.set(el, value);
      return el;
    };
    list.replaceChildren(row(null), ...state.categories.map(row));
  }

  function acceptItemDrop(el: HTMLElement, target: string): void {
    const hasItem = (e: DragEvent) => !!e.dataTransfer?.types.includes(opts.itemMime);
    el.addEventListener('dragover', e => {
      if (!hasItem(e)) return;
      e.preventDefault();
      el.classList.add('mgr-category--drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('mgr-category--drop'));
    el.addEventListener('drop', e => {
      el.classList.remove('mgr-category--drop');
      if (!hasItem(e)) return;
      e.preventDefault();
      opts.onDropItem(e.dataTransfer?.getData(opts.itemMime) ?? '', target);
    });
  }

  enableDragSort(list, '.mgr-category[draggable="true"]', items =>
    opts.onReorder(items.map(item => item.dataset.category ?? '')),
  );

  function startRename(row: HTMLElement, label: HTMLElement, old: string): void {
    if (row.querySelector('.mgr-category__input')) return;
    const input = h('input', {
      type: 'text',
      class: 'cs-input mgr-category__input',
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
      else render();
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
      render();
      return;
    }
    if (next === '' || state.categories.includes(next)) {
      const count = state.counts.get(old) ?? 0;
      const ok = await confirmDialog(
        next === ''
          ? {
              title: 'カテゴリーの変更',
              message: `「${old}」の${opts.itemNoun} ${count} 件を「${UNCATEGORIZED_LABEL}」に移しますか？`,
              confirmLabel: '移す',
            }
          : {
              title: 'カテゴリーの統合',
              message: `「${old}」の${opts.itemNoun} ${count} 件を「${next}」にまとめますか？`,
              confirmLabel: 'まとめる',
            },
      );
      if (!ok) {
        render();
        return;
      }
    }
    opts.onRename(old, next);
  }

  return { el, render };
}
