/**
 * Global keyboard shortcuts (ignored while typing in an input/textarea).
 *   Ctrl+Z undo · Ctrl+Y redo · Ctrl+S save · Ctrl+Shift+S save as · Ctrl+B background colour
 * Arrow keys in Overlay mode are handled by the canvas (features/canvas/Canvas.ts).
 */
import { emit } from '../../shared/events';
import { historyManager } from '../../shared/utils/history';

export function installShortcuts(actions: { openBgColorDialog: () => void }): void {
  window.addEventListener('keydown', e => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (!e.ctrlKey && !e.metaKey) return;

    const handlers: Record<string, () => void> = {
      z: () => void historyManager.undo(),
      y: () => void historyManager.redo(),
      s: () => emit('file:save'),
      S: () => emit('file:save-as'),
      b: actions.openBgColorDialog,
      B: actions.openBgColorDialog,
    };
    const handler = handlers[e.key];
    if (handler) {
      e.preventDefault();
      handler();
    }
  });
}
