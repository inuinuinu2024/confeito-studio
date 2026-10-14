/**
 * Global keyboard shortcuts (ignored while typing in an input / textarea / select).
 *   Ctrl+Z undo the latest deletion on the flow canvas · Ctrl+Y / Ctrl+Shift+Z redo it ·
 *   Ctrl+B settings window (背景色指定 page)
 * Ctrl+Z / Ctrl+Y are ignored while a window or dialog is open and when the key repeats (held down).
 * Arrow keys in the comparison window's Overlay are handled by the view (features/canvas/comparison-view.ts).
 */
import { historyManager } from '../../shared/utils/history';

/** A tool / settings window (they make #app inert) or a dialog is open. */
const isWindowOpen = () =>
  !!document.getElementById('app')?.inert || !!document.querySelector('.cs-modal-overlay--open, dialog[open]');

export function installShortcuts(actions: { openDisplaySettings: () => void }): void {
  window.addEventListener('keydown', e => {
    const target = e.target as HTMLElement | null;
    if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
    if (!e.ctrlKey && !e.metaKey) return;

    const redo = () => {
      if (!e.repeat && !isWindowOpen()) void historyManager.redo();
    };
    const handlers: Record<string, () => void> = {
      z: () => {
        if (!e.repeat && !isWindowOpen()) void historyManager.undo();
      },
      Z: redo,
      y: redo,
      Y: redo,
      b: actions.openDisplaySettings,
      B: actions.openDisplaySettings,
    };
    const handler = handlers[e.key];
    if (handler) {
      e.preventDefault();
      handler();
    }
  });
}
