/**
 * Typed application event bus (window CustomEvents).
 *
 * All cross-feature communication goes through the events declared in AppEventMap.
 * Use `emit()` / `on()` — never `window.dispatchEvent` directly — so that
 *   grep "emit('archives:changed'"   finds every producer,
 *   grep "on('archives:changed'"     finds every consumer,
 * and payloads are type-checked.
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

/** A selection that is not one file: a folder, or several entries (the canvas shows a message instead). */
export interface SelectionSummary {
  kind: 'folder' | 'multiple';
  /** Folder name (kind "folder"). */
  name?: string;
  /** Number of selected rows. */
  count: number;
}

/**
 * An image the comparison modes show, chosen with the ARCHIVES checkbox columns: Overlay mode's
 * underdrawing (U) and top image (T), Parallel mode's left (L) and right (R) pane.
 */
export type ViewLayer = 'under' | 'top' | 'left' | 'right';

/** A layer set to an archive image, or cleared (`key: null`). */
export interface ViewLayerSelection {
  layer: ViewLayer;
  key: string | null;
  name: string | null;
}

export interface AppEventMap {
  // ── View modes: emitted by setViewMode() (shared/state/view-mode.ts) ──
  'normal-mode:toggle': { enabled: boolean };
  'parallel-mode:toggle': { enabled: boolean };
  'overlay-mode:toggle': { enabled: boolean };
  'batch-mode:toggle': { enabled: boolean };
  /** The Prompt Manager (features/prompt-manager/) replaces ARCHIVES and the canvas. */
  'prompt-mode:toggle': { enabled: boolean };

  // ── Current document (features/document/DocumentManager.ts) ──
  'document:loaded': DocumentLoadedDetail;
  /** Asks the canvas to repaint. */
  'document:redraw': undefined;

  // ── ARCHIVES panel → Canvas ──
  'archive:item-selected': ArchiveSelection;
  'archive:selection-cleared': undefined;
  /** A folder or several entries are selected (not Batch mode): the pane shows no image. */
  'archive:selection-summary': SelectionSummary;
  /** Batch mode: images to show as a grid (a folder's images, or the selected files in tree order). */
  'archive:batch-selected': { items: ArchiveSelection[] };
  /** Files changed on disk → panels reload and optionally select `autoSelectKey`. */
  'archives:changed': { autoSelectKey?: string } | undefined;

  // ── Overlay / Parallel mode ──
  /**
   * U / T or L / R chosen with the ARCHIVES checkboxes; the canvas emits `key: null` when the image
   * cannot be loaded or was deleted, so the checkbox is cleared too.
   */
  'view:layer-selected': ViewLayerSelection;

  // ── Tool execution → StatusBar ──
  'tool:start': { toolName: string };
  'tool:progress': { message: string };
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
