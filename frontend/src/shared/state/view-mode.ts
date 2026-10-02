/**
 * View mode store: exactly one of normal / compare / overlay / batch is active.
 *
 * `setViewMode()` is the only way to change it. Listeners receive the per-mode
 * `<mode>-mode:toggle` events, always emitted in MODE_ORDER: the target mode is
 * switched on and every other active mode switched off. Read the current mode
 * with `getViewMode()` / `isViewMode()` instead of keeping local copies.
 */
import { emit } from '../events';

export type ViewMode = 'normal' | 'compare' | 'overlay' | 'batch';

const MODE_ORDER: ViewMode[] = ['normal', 'compare', 'overlay', 'batch'];
const TOGGLE_EVENT = {
  normal: 'normal-mode:toggle',
  compare: 'compare-mode:toggle',
  overlay: 'overlay-mode:toggle',
  batch: 'batch-mode:toggle',
} as const;

let current: ViewMode = 'normal';

export function getViewMode(): ViewMode {
  return current;
}

export function isViewMode(mode: ViewMode): boolean {
  return current === mode;
}

export function setViewMode(mode: ViewMode): void {
  if (mode === current) return;
  const previous = current;
  current = mode;
  for (const m of MODE_ORDER) {
    if (m === mode) emit(TOGGLE_EVENT[m], { enabled: true });
    else if (m === previous) emit(TOGGLE_EVENT[m], { enabled: false });
  }
}

/** Clicking the active mode's button returns to normal mode. */
export function toggleViewMode(mode: ViewMode): void {
  setViewMode(current === mode && mode !== 'normal' ? 'normal' : mode);
}
