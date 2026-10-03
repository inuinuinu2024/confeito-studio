/**
 * AI panel tool contract. Each tool lives in features/tools/<id>.ts and is listed in
 * features/tools/index.ts (docs/architecture/frontend.md 「ツールを追加する」).
 * How a run is reported to the user: docs/specs/notifications.md.
 */

/** What a tool can read from the app when it runs. */
export interface ToolContext {
  /** Copy of the image currently shown on the canvas (selected in ARCHIVES), or null. */
  getSelectedImage(): Promise<HTMLCanvasElement | null>;
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
   * Runs the tool and resolves with a short Japanese summary of the result
   * (shown as "<name>: <summary>"). Throw `ToolNotReady` when an input is missing,
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
