/**
 * ToolBar — left column of view mode buttons (state lives in shared/state/view-mode.ts), in groups
 * separated by thin dividers: Normal, Batch | the comparison views Parallel, Overlay | the managers
 * (Prompt / Character / Object / Style; not implemented yet).
 */
import './tool-bar.css';
import { on } from '../../shared/events';
import { getViewMode, toggleViewMode, type ViewMode } from '../../shared/state/view-mode';
import { h, icon } from '../../shared/ui/dom';
import { showToast } from '../../shared/ui/toast';

const MODES: { mode: ViewMode; title: string; icon: string }[] = [
  { mode: 'normal', title: 'Normal Mode', icon: 'image' },
  { mode: 'batch', title: 'Batch Mode', icon: 'grid_view' },
  { mode: 'parallel', title: 'Parallel View', icon: 'compare' },
  { mode: 'overlay', title: 'Overlay View', icon: 'photo_library' },
];
/** The divider goes before this mode (the comparison views follow it). */
const DIVIDER_BEFORE: ViewMode = 'parallel';
/** Managers below the modes (not implemented yet: they show a "開発中" toast). */
const MANAGERS: { title: string; icon: string }[] = [
  { title: 'Prompt Manager', icon: 'chat' },
  { title: 'Character Manager', icon: 'person' },
  { title: 'Object Manager', icon: 'eyeglasses' },
  { title: 'Style Manager', icon: 'brush' },
];

export function createToolBar(): HTMLElement {
  const buttons = MODES.map(m =>
    h('div', { class: 'left-toolbar__btn', title: m.title, onclick: () => toggleViewMode(m.mode) }, icon(m.icon, 24)),
  );
  // Batch mode still opens, with a notice that it is being reworked.
  on('batch-mode:toggle', ({ enabled }) => {
    if (enabled) showToast('Batch モードは現在修正中です', 'info');
  });
  const render = () => {
    const current = getViewMode();
    buttons.forEach((btn, i) => btn.classList.toggle('left-toolbar__btn--active', MODES[i].mode === current));
  };
  for (const event of [
    'normal-mode:toggle',
    'parallel-mode:toggle',
    'overlay-mode:toggle',
    'batch-mode:toggle',
  ] as const) {
    on(event, render);
  }
  render();
  const managers = MANAGERS.map(m =>
    h(
      'div',
      { class: 'left-toolbar__btn', title: m.title, onclick: () => showToast(m.title, 'mock') },
      icon(m.icon, 24),
    ),
  );
  const divider = () => h('div', { class: 'left-toolbar__divider' });
  const modeItems = buttons.flatMap((btn, i) => (MODES[i].mode === DIVIDER_BEFORE ? [divider(), btn] : [btn]));
  return h('div', { class: 'left-toolbar' }, ...modeItems, divider(), ...managers);
}
