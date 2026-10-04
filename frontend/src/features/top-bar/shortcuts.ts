/**
 * Global keyboard shortcuts (ignored while typing in an input / textarea / select).
 *   Ctrl+Z undo the latest ARCHIVES deletion · Ctrl+B settings window (背景色指定 page)
 * Ctrl+Z is ignored while a window or dialog is open and when the key repeats (held down).
 * Arrow keys in Overlay mode are handled by the canvas (features/canvas/Canvas.ts).
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

    const handlers: Record<string, () => void> = {
      z: () => {
        if (!e.repeat && !isWindowOpen()) void historyManager.undo();
      },
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
