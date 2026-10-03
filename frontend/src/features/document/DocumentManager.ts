/**
 * DocumentManager — the image currently shown on the canvas and the archive folder
 * that tools save into.
 *
 * - `getCurrentCanvas()` is what tools process (set when an archive image is selected).
 * - `getCurrentArchiveFolder()` is the selected place in ARCHIVES (null when nothing is selected):
 *   the top-level archive for a selected file, or the selected (sub)folder key
 *   (e.g. "root/sub") when a folder row is selected. Tools save into its top-level archive
 *   (features/tools/result.ts); コマ結合 reads its panels from it.
 * - `getCurrentKey()` is the ARCHIVES key of the current image (the source recorded in info.json).
 */
import { emit } from '../../shared/events';

export class DocumentManager {
  private static instance: DocumentManager | undefined;
  private currentCanvas: HTMLCanvasElement | null = null;
  private currentFilename: string | null = null;
  /** ARCHIVES key of the current image; null when no image is shown. */
  private currentKey: string | null = null;
  private currentArchiveFolder: string | null = null;

  static getInstance(): DocumentManager {
    DocumentManager.instance ??= new DocumentManager();
    return DocumentManager.instance;
  }

  getCurrentCanvas(): HTMLCanvasElement | null {
    return this.currentCanvas;
  }

  getCurrentFilename(): string | null {
    return this.currentFilename;
  }

  /** ARCHIVES key of the current image ("<archive>/<path>"), recorded as the source of tool results. */
  getCurrentKey(): string | null {
    return this.currentKey;
  }

  getCurrentArchiveFolder(): string | null {
    return this.currentArchiveFolder;
  }

  setCurrentArchiveFolder(folder: string | null): void {
    this.currentArchiveFolder = folder;
  }

  /** Replaces the current image (null clears it) and notifies the canvas. `key`: its ARCHIVES key, if any. */
  setCanvas(canvas: HTMLCanvasElement | null, filename?: string, key: string | null = null): void {
    this.currentCanvas = canvas;
    this.currentKey = canvas ? key : null;
    if (filename !== undefined) this.currentFilename = filename;
    if (canvas) {
      emit('document:loaded', {
        canvas,
        filename: this.currentFilename || 'Untitled.png',
        width: canvas.width,
        height: canvas.height,
      });
    }
    emit('document:redraw');
  }
}
