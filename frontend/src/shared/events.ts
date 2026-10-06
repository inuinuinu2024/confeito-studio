/**
 * Typed application event bus (window CustomEvents).
 *
 * All cross-feature communication goes through the events declared in AppEventMap.
 * Use `emit()` / `on()` — never `window.dispatchEvent` directly — so that
 *   grep "emit('archives:changed'"   finds every producer,
 *   grep "on('archives:changed'"     finds every consumer,
 * and payloads are type-checked.
 */

import type { FlowImage } from './types/flow';

/**
 * An image the comparison modes show: Overlay mode's underdrawing (U) and top image (T), Parallel mode's
 * left (L) and right (R) pane (taken from the canvas selection when the mode starts).
 */
export type ViewLayer = 'under' | 'top' | 'left' | 'right';

/** What happens to one image of a tool run (the flow canvas marks the cell). */
export type ToolTargetState = 'running' | 'done' | 'failed';

export interface AppEventMap {
  // ── View modes: emitted by setViewMode() (shared/state/view-mode.ts) ──
  'normal-mode:toggle': { enabled: boolean };
  'parallel-mode:toggle': { enabled: boolean };
  'overlay-mode:toggle': { enabled: boolean };
  /** The Prompt Manager (features/prompt-manager/) replaces the canvas with its sidebar and main area. */
  'prompt-mode:toggle': { enabled: boolean };
  /** The Character Manager (features/character-manager/) replaces the canvas with its sidebar and main area. */
  'character-mode:toggle': { enabled: boolean };
  /** The Cost Monitor (features/cost-monitor/) replaces the canvas. */
  'cost-mode:toggle': { enabled: boolean };

  // ── Flow canvas (features/flow-canvas/) ──
  /** The images selected on the canvas changed (DocumentManager.setSelection), in selection order. */
  'flow:selection-changed': { images: readonly FlowImage[] };
  /**
   * Files changed on disk → the canvas reloads. `select`: images to select afterwards (the canvas switches to
   * their archive); `archive`: the archive to show (e.g. one restored by undo). Without them it stays.
   */
  'archives:changed': { select?: string[]; archive?: string } | undefined;
  /**
   * The archives folder was switched (settings window 保存先): the canvas forgets the selection and the
   * deletions to undo, and shows the newest archive of the new folder.
   */
  'archives:location-changed': undefined;

  // ── Tool execution → StatusBar ──
  'tool:start': { toolName: string };
  'tool:progress': { message: string };
  /** One image of a run starts / is done / failed (the flow canvas marks its cell). */
  'tool:target': { key: string; state: ToolTargetState };
  'tool:end': undefined;

  // ── Misc ──
  'canvas:bg-color': { color: string };
  /** The Gemini API key was saved. */
  'settings:updated': undefined;
  /** The undo stack or its running state changed (historyManager.canUndo()). */
  'history:changed': undefined;
}

export type AppEventName = keyof AppEventMap;

type DetailArgs<K extends AppEventName> = undefined extends AppEventMap[K]
  ? [detail?: AppEventMap[K]]
  : [detail: AppEventMap[K]];

export function emit<K extends AppEventName>(name: K, ...args: DetailArgs<K>): void {
  window.dispatchEvent(new CustomEvent(name, { detail: args[0] }));
}

/** Subscribes to an event; returns an unsubscribe function. */
export function on<K extends AppEventName>(name: K, handler: (detail: AppEventMap[K]) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<AppEventMap[K]>).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
