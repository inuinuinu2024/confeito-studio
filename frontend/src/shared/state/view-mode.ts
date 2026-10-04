/**
 * View mode store: exactly one of normal / parallel / overlay / batch / prompt (Prompt Manager) /
 * character (Character Manager) / cost (Cost Monitor) is active.
 *
 * `setViewMode()` is the only way to change it. Listeners receive the per-mode
 * `<mode>-mode:toggle` events, always emitted in MODE_ORDER: the target mode is
 * switched on and every other active mode switched off. Read the current mode
 * with `getViewMode()` / `isViewMode()` instead of keeping local copies.
 * A mode can register a leave guard (e.g. unsaved changes) that the mode buttons wait for.
 */
import { emit } from '../events';

export type ViewMode = 'normal' | 'parallel' | 'overlay' | 'batch' | 'prompt' | 'character' | 'cost';

const MODE_ORDER: ViewMode[] = ['normal', 'parallel', 'overlay', 'batch', 'prompt', 'character', 'cost'];
const TOGGLE_EVENT = {
  normal: 'normal-mode:toggle',
  parallel: 'parallel-mode:toggle',
  overlay: 'overlay-mode:toggle',
  batch: 'batch-mode:toggle',
  prompt: 'prompt-mode:toggle',
  character: 'character-mode:toggle',
  cost: 'cost-mode:toggle',
} as const;

let current: ViewMode = 'normal';
/** Asked before leaving a mode; resolves false to stay. */
const leaveGuards: Partial<Record<ViewMode, () => Promise<boolean>>> = {};

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

export function setLeaveGuard(mode: ViewMode, guard: () => Promise<boolean>): void {
  leaveGuards[mode] = guard;
}

/** Clicking the active mode's button returns to normal mode. Waits for the current mode's leave guard. */
export async function toggleViewMode(mode: ViewMode): Promise<void> {
  const next = current === mode && mode !== 'normal' ? 'normal' : mode;
  if (next === current) return;
  const guard = leaveGuards[current];
  if (guard && !(await guard())) return;
  setViewMode(next);
}
