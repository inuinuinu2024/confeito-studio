/**
 * ToolBar — left column of view mode buttons (state lives in shared/state/view-mode.ts), in groups
 * separated by thin dividers: Normal | the comparison views Parallel, Overlay | the managers
 * (Prompt Manager / Character Manager are the "prompt" / "character" view modes; Object / Style are not
 * implemented yet) | the monitors (Cost Monitor is the "cost" view mode).
 */
import './tool-bar.css';
import { on } from '../../shared/events';
import { getViewMode, toggleViewMode, type ViewMode } from '../../shared/state/view-mode';
import { h, icon } from '../../shared/ui/dom';
import { showToast } from '../../shared/ui/toast';

interface ButtonDef {
  title: string;
  icon: string;
}

const MODES: Record<ViewMode, ButtonDef> = {
  normal: { title: 'Workspace', icon: 'account_tree' },
  parallel: { title: 'Parallel View', icon: 'compare' },
  overlay: { title: 'Overlay View', icon: 'photo_library' },
  prompt: { title: 'Prompt Manager', icon: 'chat' },
  character: { title: 'Character Manager', icon: 'person' },
  cost: { title: 'Cost Monitor', icon: 'browse_activity' },
};

/** Top to bottom: a view mode, a divider, or a button that is not implemented yet (shows a "開発中" toast). */
const ITEMS: (ViewMode | 'divider' | ButtonDef)[] = [
  'normal',
  'divider',
  'parallel',
  'overlay',
  'divider',
  'prompt',
  'character',
  { title: 'Object Manager', icon: 'eyeglasses' },
  { title: 'Style Manager', icon: 'brush' },
  'divider',
  'cost',
];

export function createToolBar(): HTMLElement {
  const modeButtons = new Map<ViewMode, HTMLElement>();
  const items = ITEMS.map(item => {
    if (item === 'divider') return h('div', { class: 'left-toolbar__divider' });
    if (typeof item === 'object') {
      return h(
        'div',
        { class: 'left-toolbar__btn', title: item.title, onclick: () => showToast(item.title, 'mock') },
        icon(item.icon, 24),
      );
    }
    const def = MODES[item];
    const btn = h(
      'div',
      { class: 'left-toolbar__btn', title: def.title, onclick: () => void toggleViewMode(item) },
      icon(def.icon, 24),
    );
    modeButtons.set(item, btn);
    return btn;
  });
  const render = () => {
    const current = getViewMode();
    modeButtons.forEach((btn, mode) => btn.classList.toggle('left-toolbar__btn--active', mode === current));
  };
  for (const event of [
    'normal-mode:toggle',
    'parallel-mode:toggle',
    'overlay-mode:toggle',
    'prompt-mode:toggle',
    'character-mode:toggle',
    'cost-mode:toggle',
  ] as const) {
    on(event, render);
  }
  render();
  return h('div', { class: 'left-toolbar' }, ...items);
}
