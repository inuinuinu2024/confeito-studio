/**
 * DocumentManager — what tools work on: the archive shown on the Normal mode canvas (results are saved
 * into it), its flow, and the images selected on the canvas (docs/specs/flow-canvas.md).
 *
 * - `getArchive()` / `getArchiveName()` / `getFlow()`: set by the flow canvas (features/flow-canvas/) when it loads
 *   an archive.
 * - `getSelection()`: the selected images in the order they were selected. Tools run once per image
 *   (features/ai-panel/tool-runner.ts).
 */
import { emit } from '../../shared/events';
import type { FlowData, FlowImage } from '../../shared/types/flow';

export class DocumentManager {
  private static instance: DocumentManager | undefined;
  private archive: string | null = null;
  private archiveName: string | null = null;
  private flow: FlowData | null = null;
  private selection: FlowImage[] = [];

  static getInstance(): DocumentManager {
    DocumentManager.instance ??= new DocumentManager();
    return DocumentManager.instance;
  }

  /** The archive shown on the canvas (where results are saved), or null when there is none. */
  getArchive(): string | null {
    return this.archive;
  }

  /** The display name of the shown archive (docs/specs/archives.md 「表示名」), or null when there is none. */
  getArchiveName(): string | null {
    return this.archiveName;
  }

  /** The flow of the shown archive (null while none is loaded). */
  getFlow(): FlowData | null {
    return this.flow;
  }

  setFlow(archive: string | null, flow: FlowData | null, archiveName: string | null = archive): void {
    this.archive = archive;
    this.archiveName = archive ? archiveName : null;
    this.flow = flow;
  }

  getSelection(): readonly FlowImage[] {
    return this.selection;
  }

  /** Replaces the selection and emits `flow:selection-changed` when it changed. */
  setSelection(images: readonly FlowImage[]): void {
    const same =
      images.length === this.selection.length && images.every((image, i) => image.key === this.selection[i].key);
    this.selection = [...images];
    if (!same) emit('flow:selection-changed', { images: this.selection });
  }
}
