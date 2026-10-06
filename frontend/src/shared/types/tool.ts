/**
 * AI panel tool contract. Each tool lives in features/tools/<id>.ts and is listed in
 * features/tools/index.ts (docs/architecture/frontend.md 「ツールを追加する」).
 * How a run is reported to the user: docs/specs/notifications.md.
 */

import type { FlowImage } from './flow';

/**
 * What one run of a tool processes: usually an image selected on the canvas; コマ結合 uses a コマ分割
 * result folder. Tools that need no input run once with `null`.
 */
export interface RunTarget {
  /** Archive key of the image (or folder). */
  key: string;
  name: string;
  width?: number | null;
  height?: number | null;
}

/** What a tool can read from the app when it runs (once per target, docs/specs/ai-panel.md 「まとめて実行」). */
export interface ToolContext {
  /** What this run processes (null for a tool without input). Record its key as the result's source. */
  target: RunTarget | null;
  /** The target image loaded into a canvas, or null (no target, or it cannot be loaded). */
  getSelectedImage(): Promise<HTMLCanvasElement | null>;
  /**
   * Call once the inputs are checked (after the last `ToolNotReady`): the tool window closes here and
   * the run goes on behind it (docs/specs/ai-panel.md 「ツールの実行」). Without it the window closes on success.
   */
  ready(): void;
  /**
   * Aborted when the user stops the run (docs/specs/ai-panel.md 「実行の停止」). Pass it to requests whose
   * result the tool saves itself; a result the backend already saved is removed with `discardIfStopped`.
   */
  signal: AbortSignal;
}

export interface Tool {
  /** Stable id (also used for settings / archive naming in some tools). */
  id: string;
  /** Label shown in the AI panel; also the key stored in the tool order (settings file). */
  name: string;
  /** Material Symbols icon name; empty for no icon. */
  icon?: string;
  /**
   * Renders the settings into the tool window. Tools without it run immediately on click.
   * Called every time the window opens.
   */
  renderSettings?: (container: HTMLElement) => void;
  /** Prepares the tool's state before its window opens (after the settings are read). */
  beforeOpen?: () => Promise<void>;
  /**
   * Side-by-side columns in the tool window (400px each; e.g. 3 for Nano Banana画像生成). renderSettings then
   * appends that many `.tool-window__column` elements, each scrolling on its own. Default: one column.
   */
  windowColumns?: number;
  /**
   * Key prefix of the tool's `toolSettings`. Its changed settings are saved when a run starts
   * (docs/specs/app-shell.md 「設定の保存」); tools without settings leave it out.
   */
  settingsPrefix?: string;
  /** Icon of the tool window's run button, which is always labelled 「実行」 (default "auto_awesome"; null = no icon). */
  executeIcon?: string | null;
  /**
   * What to run on, one run each, in order (features/ai-panel/run-targets.ts). Default: every selected image,
   * and nothing to run (a warning) without a selection. Return `[null]` to run once without input, or throw
   * `ToolNotReady` with how to choose the input.
   */
  targets?: (selection: readonly FlowImage[]) => (RunTarget | null)[];
  /**
   * Runs the tool and resolves with a short Japanese summary of the result
   * (shown as "<name>: <summary>"). Throw `ToolNotReady` when an input is missing (then call `context.ready()`),
   * `ToolCancelled` when the user cancels, and `AppMessageError` (or let `ApiError` through) on failure.
   */
  execute(context: ToolContext): Promise<string>;
}

/** Thrown when the tool cannot run yet (e.g. no image selected); shown as a warning, not a failure. */
export class ToolNotReady extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolNotReady';
  }
}

/** Thrown when the user cancels (e.g. closes a file picker); the runner stays silent. */
export class ToolCancelled extends Error {
  constructor() {
    super('AbortError');
    this.name = 'AbortError';
  }
}
