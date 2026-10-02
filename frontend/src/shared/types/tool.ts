/**
 * AI panel tool contract. Each tool lives in features/tools/<id>.ts and is listed in
 * features/tools/index.ts (docs/architecture/frontend.md 「ツールを追加する」).
 */

/** What a tool can read from the app when it runs. */
export interface ToolContext {
  /** Copy of the image currently shown on the canvas (selected in ARCHIVES), or null. */
  getSelectedImage(): Promise<HTMLCanvasElement | null>;
}

export interface Tool {
  /** Stable id (also used for settings / archive naming in some tools). */
  id: string;
  /** Label shown in the AI panel; also the key stored in the tool order (localStorage). */
  name: string;
  /** Material Symbols icon name; empty for no icon. */
  icon?: string;
  /**
   * Renders the settings sidebar. Tools without it run immediately on click.
   * Called every time the sidebar opens.
   */
  renderSettings?: (container: HTMLElement) => void;
  /** Return false to refuse opening/running (show a toast explaining why). */
  canOpen?: () => boolean;
  /** Label of the sidebar's run button (default "生成する"). */
  executeLabel?: string;
  /** Icon of the run button (default "auto_awesome"; null = no icon). */
  executeIcon?: string | null;
  execute(context: ToolContext): Promise<void>;
}

/** Thrown by tools that already wrote their own error archive (the runner then skips error.txt). */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly archiveSaved = false,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Thrown when the user cancels (e.g. closes a file picker); the runner stays silent. */
export class ToolCancelled extends Error {
  constructor() {
    super('AbortError');
    this.name = 'AbortError';
  }
}
