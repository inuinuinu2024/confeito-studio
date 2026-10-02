/** ToolBar — left column of view mode buttons (state lives in shared/state/view-mode.ts). */
import './tool-bar.css';
import { on } from '../../shared/events';
import { getViewMode, toggleViewMode, type ViewMode } from '../../shared/state/view-mode';
import { h, icon } from '../../shared/ui/dom';

const MODES: { mode: ViewMode; title: string; icon: string }[] = [
  { mode: 'normal', title: 'Normal Mode', icon: 'image' },
  { mode: 'compare', title: 'Compare Mode', icon: 'compare' },
  { mode: 'overlay', title: 'Overlay Mode', icon: 'photo_library' },
  { mode: 'batch', title: 'Batch Mode', icon: 'grid_view' },
];

export function createToolBar(): HTMLElement {
  const buttons = MODES.map(m =>
    h('div', { class: 'left-toolbar__btn', title: m.title, onclick: () => toggleViewMode(m.mode) }, icon(m.icon, 24)),
  );
  const render = () => {
    const current = getViewMode();
    buttons.forEach((btn, i) => btn.classList.toggle('left-toolbar__btn--active', MODES[i].mode === current));
  };
  for (const event of [
    'normal-mode:toggle',
    'compare-mode:toggle',
    'overlay-mode:toggle',
    'batch-mode:toggle',
  ] as const) {
    on(event, render);
  }
  render();
  return h('div', { class: 'left-toolbar' }, ...buttons);
}
