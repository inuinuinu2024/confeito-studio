/**
 * ToolBar — left column of view mode buttons (state lives in shared/state/view-mode.ts):
 * Normal, Batch | divider | the comparison modes Parallel, Overlay.
 */
import './tool-bar.css';
import { on } from '../../shared/events';
import { getViewMode, toggleViewMode, type ViewMode } from '../../shared/state/view-mode';
import { h, icon } from '../../shared/ui/dom';
import { showToast } from '../../shared/ui/toast';

const MODES: { mode: ViewMode; title: string; icon: string }[] = [
  { mode: 'normal', title: 'Normal Mode', icon: 'image' },
  { mode: 'batch', title: 'Batch Mode', icon: 'grid_view' },
  { mode: 'parallel', title: 'Parallel Mode', icon: 'compare' },
  { mode: 'overlay', title: 'Overlay Mode', icon: 'photo_library' },
];
/** The divider goes before this mode (the comparison modes follow it). */
const DIVIDER_BEFORE: ViewMode = 'parallel';

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
  const items = buttons.flatMap((btn, i) =>
    MODES[i].mode === DIVIDER_BEFORE ? [h('div', { class: 'left-toolbar__divider' }), btn] : [btn],
  );
  return h('div', { class: 'left-toolbar' }, ...items);
}
