/**
 * Typed application event bus (window CustomEvents).
 *
 * All cross-feature communication goes through the events declared in AppEventMap.
 * Use `emit()` / `on()` — never `window.dispatchEvent` directly — so that
 *   grep "emit('archives:changed'"   finds every producer,
 *   grep "on('archives:changed'"     finds every consumer,
 * and payloads are type-checked.
 *
 * Events suffixed with `:right` come from the second ARCHIVES panel shown in Compare mode.
 */

/** An archive entry chosen in the ARCHIVES panel. */
export interface ArchiveSelection {
  /** "<archive>/<relative path>" */
  key: string;
  /** File name shown in the panel. */
  name: string;
}

export interface DocumentLoadedDetail {
  canvas: HTMLCanvasElement;
  filename: string;
  width: number;
  height: number;
}

export interface UnderdrawingSelection {
  id: string | null;
  cacheKey: string | null;
  name: string | null;
}

export interface AppEventMap {
  // ── View modes: emitted by setViewMode() (shared/state/view-mode.ts) ──
  'normal-mode:toggle': { enabled: boolean };
  'compare-mode:toggle': { enabled: boolean };
  'overlay-mode:toggle': { enabled: boolean };
  'batch-mode:toggle': { enabled: boolean };

  // ── Current document (features/document/DocumentManager.ts) ──
  'document:loaded': DocumentLoadedDetail;
  /** Asks the canvas to repaint. */
  'document:redraw': undefined;

  // ── ARCHIVES panel → Canvas ──
  'archive:item-selected': ArchiveSelection;
  'archive:item-selected:right': ArchiveSelection;
  'archive:selection-cleared': undefined;
  'archive:selection-cleared:right': undefined;
  /** Batch mode: images to show as a grid (a folder's images, or the selected files in tree order). */
  'archive:batch-selected': { items: ArchiveSelection[] };
  /** Files changed on disk → panels reload and optionally select `autoSelectKey`. */
  'archives:changed': { autoSelectKey?: string } | undefined;

  // ── Overlay mode ──
  'overlay:underdrawing-selected': UnderdrawingSelection;
  'overlay:underdrawing-selected:right': UnderdrawingSelection;
  /** Overlay mode or the U selection changed → panels re-sync their checkboxes. */
  'overlay-mode:changed': undefined;
  'overlay:top-opacity': { opacity: number };
  'overlay:underdrawing-color': { color: string | null };

  // ── Tool execution → StatusBar ──
  'tool:start': { toolName: string };
  'tool:progress': { message: string };
  'tool:end': undefined;

  // ── Misc ──
  'canvas:bg-color': { color: string };
  /** The Gemini API key was saved. */
  'settings:updated': undefined;
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
