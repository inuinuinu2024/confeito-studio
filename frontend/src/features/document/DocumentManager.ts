/**
 * DocumentManager — the image currently shown on the canvas and the archive folder
 * that tools save into.
 *
 * - `getCurrentCanvas()` is what tools process (set when an archive image is selected).
 * - `getCurrentArchiveFolder()` is where tools write results. It holds an archive key:
 *   the top-level archive for a selected file, or the selected (sub)folder key
 *   (e.g. "root/sub") when a folder row is selected.
 * - File > Save / Save As writes the canvas through the File System Access API; the
 *   handle is cached in IndexedDB and that file is reopened on the next start.
 */
import { emit, on } from '../../shared/events';
import { showToast } from '../../shared/ui/toast';
import { canvasToBlob, toCanvas } from '../../shared/utils/image';
import { getDocumentCache, setDocumentCache } from '../../shared/utils/idb';

const SAVE_TYPES: FilePickerAcceptType[] = [
  { description: 'PNG Image', accept: { 'image/png': ['.png'] } },
  { description: 'JPEG Image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
  { description: 'WebP Image', accept: { 'image/webp': ['.webp'] } },
];

const CONFIRM_DISCARD = '変更内容を保存しましたか？保存していない内容は失われます。\n\n画像を閉じてもよろしいですか？';

function mimeTypeFor(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

async function ensurePermission(handle: FileSystemHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

export class DocumentManager {
  private static instance: DocumentManager | undefined;
  private currentCanvas: HTMLCanvasElement | null = null;
  private currentFilename: string | null = null;
  private currentFileHandle: FileSystemFileHandle | null = null;
  private currentArchiveFolder: string | null = null;

  static getInstance(): DocumentManager {
    DocumentManager.instance ??= new DocumentManager();
    return DocumentManager.instance;
  }

  private constructor() {
    on('file:save', () => void this.save(false));
    on('file:save-as', () => void this.save(true));
    on('file:close', () => this.close());
    void this.restoreLastFile();
  }

  getCurrentCanvas(): HTMLCanvasElement | null {
    return this.currentCanvas;
  }

  getCurrentFilename(): string | null {
    return this.currentFilename;
  }

  getCurrentArchiveFolder(): string | null {
    return this.currentArchiveFolder;
  }

  setCurrentArchiveFolder(folder: string | null): void {
    this.currentArchiveFolder = folder;
  }

  /** Replaces the current image (null clears it) and notifies the canvas. */
  setCanvas(canvas: HTMLCanvasElement | null, filename?: string): void {
    this.currentCanvas = canvas;
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

  private close(): void {
    if (!this.currentCanvas || !window.confirm(CONFIRM_DISCARD)) return;
    this.currentCanvas = null;
    this.currentFilename = null;
    this.currentFileHandle = null;
    this.currentArchiveFolder = null;
    emit('document:closed');
    showToast('画像を閉じました');
  }

  private async save(isSaveAs: boolean): Promise<void> {
    if (!this.currentCanvas || !this.currentFilename) {
      showToast('No image loaded to save.');
      return;
    }

    let filename = this.currentFilename.replace(/\.psd$/i, '.png');
    let handle: FileSystemFileHandle | null = isSaveAs ? null : this.currentFileHandle;

    if ((isSaveAs || !handle) && window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: SAVE_TYPES,
          startIn: this.currentFileHandle ?? undefined,
        });
        filename = handle.name;
        this.currentFilename = filename;
        this.currentFileHandle = handle;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.warn('showSaveFilePicker failed:', err);
      }
    } else if (isSaveAs) {
      let newName = prompt('Enter image file name (e.g. image.png):', filename);
      if (!newName) return;
      if (!newName.includes('.')) newName += '.png';
      filename = newName;
      this.currentFilename = filename;
    }

    showToast(`Saving ${filename}...`);
    try {
      const blob = await canvasToBlob(this.currentCanvas, mimeTypeFor(filename), 0.95);
      if (!blob) throw new Error('Failed to create image blob');

      if (handle) {
        if (!(await ensurePermission(handle, 'readwrite'))) throw new Error('Permission to write denied by user.');
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }

      await setDocumentCache(filename, this.currentFileHandle);
      showToast(`${filename} saved successfully!`, 'success');
    } catch (err) {
      console.error('Save failed:', err);
      showToast(`Failed to save ${filename}.`, 'error');
    }
  }

  /** Reopens the last saved file; if permission needs a user gesture, retries on the next click. */
  private async restoreLastFile(): Promise<void> {
    try {
      const cache = await getDocumentCache();
      const handle = cache?.fileHandle;
      if (!cache || !handle || cache.filename.toLowerCase().endsWith('.psd')) return;

      const attempt = async (interactive: boolean): Promise<boolean> => {
        try {
          if (!(await ensurePermission(handle, 'read'))) return false;
          showToast(`Restoring ${cache.filename}...`);
          const file = await handle.getFile();
          if (file.name.toLowerCase().endsWith('.psd')) return false;
          this.currentFileHandle = handle;
          await this.loadFile(file);
          showToast(`${cache.filename} restored.`);
          return true;
        } catch (err) {
          if (interactive) {
            console.error('Failed to restore file interactively', err);
            showToast(`Please open ${cache.filename} manually.`, 'error');
          }
          return false;
        }
      };

      if (!(await attempt(false))) {
        const onClick = () => {
          document.removeEventListener('click', onClick, true);
          void attempt(true);
        };
        document.addEventListener('click', onClick, true);
      }
    } catch (err) {
      console.error('Failed to load cached image', err);
    }
  }

  private async loadFile(file: File): Promise<void> {
    showToast(`Loading ${file.name}...`);
    try {
      const canvas = toCanvas(await createImageBitmap(file));
      this.currentCanvas = canvas;
      this.currentFilename = file.name;
      await setDocumentCache(file.name, this.currentFileHandle);
      showToast(`${file.name} loaded successfully!`, 'success');
      emit('document:loaded', { canvas, filename: file.name, width: canvas.width, height: canvas.height });
      emit('document:redraw');
    } catch (err) {
      console.error('Error loading image:', err);
      showToast('Error loading image file.', 'error');
    }
  }
}

export function initDocumentManager(): void {
  DocumentManager.getInstance();
}
