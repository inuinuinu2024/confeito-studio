import { showToast } from '../../shared/utils/toast';
import { setDocumentCache, getDocumentCache, addRecentFile } from '../../shared/utils/idb';

export class DocumentManager {
  private static instance: DocumentManager;
  private currentCanvas: HTMLCanvasElement | null = null;
  private currentFilename: string | null = null;
  private currentFileHandle: any = null;
  private fileInput: HTMLInputElement;

  private constructor() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/png, image/jpeg, image/webp, image/bmp, image/gif';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);

    this.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
    window.addEventListener('file:new', this.handleFileNew.bind(this));
    window.addEventListener('file:open', this.handleFileOpen.bind(this));
    window.addEventListener('file:save', () => this.handleFileSave(false));
    window.addEventListener('file:save-as', () => this.handleFileSave(true));
    window.addEventListener('file:close', this.handleFileClose.bind(this));
    window.addEventListener('file:open-recent', this.handleFileOpenRecent.bind(this) as unknown as EventListener);

    // Load cached image on startup
    this.loadCachedImage();
  }

  private async handleFileSave(isSaveAs: boolean = false) {
    if (!this.currentCanvas || !this.currentFilename) {
      showToast('No image loaded to save.');
      return;
    }

    let saveFilename = this.currentFilename;
    // If filename still ends with .psd, change extension to .png
    if (saveFilename.toLowerCase().endsWith('.psd')) {
      saveFilename = saveFilename.replace(/\.psd$/i, '.png');
    }

    let fileHandle: FileSystemFileHandle | null = isSaveAs ? null : this.currentFileHandle;

    if ((isSaveAs || !fileHandle) && 'showSaveFilePicker' in window) {
      try {
        const options: any = {
          suggestedName: saveFilename,
          types: [
            {
              description: 'PNG Image',
              accept: { 'image/png': ['.png'] },
            },
            {
              description: 'JPEG Image',
              accept: { 'image/jpeg': ['.jpg', '.jpeg'] },
            },
            {
              description: 'WebP Image',
              accept: { 'image/webp': ['.webp'] },
            }
          ],
        };
        if (this.currentFileHandle) {
          options.startIn = this.currentFileHandle;
        }
        fileHandle = await (window as any).showSaveFilePicker(options);
        if (fileHandle) {
          saveFilename = (fileHandle as any).name;
          this.currentFilename = saveFilename;
          this.currentFileHandle = fileHandle;
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.warn('showSaveFilePicker failed:', err);
      }
    } else if (isSaveAs) {
      let newName = prompt('Enter image file name (e.g. image.png):', saveFilename);
      if (!newName) return;
      if (!newName.includes('.')) {
        newName += '.png';
      }
      saveFilename = newName;
      this.currentFilename = saveFilename;
    }

    showToast(`Saving ${saveFilename}...`);

    try {
      const mimeType = saveFilename.toLowerCase().endsWith('.jpg') || saveFilename.toLowerCase().endsWith('.jpeg')
        ? 'image/jpeg'
        : saveFilename.toLowerCase().endsWith('.webp')
          ? 'image/webp'
          : 'image/png';

      const blob: Blob | null = await new Promise((resolve) => {
        this.currentCanvas!.toBlob((b) => resolve(b), mimeType, 0.95);
      });

      if (!blob) {
        throw new Error('Failed to create image blob');
      }

      if (fileHandle) {
        const handle = fileHandle as any;
        if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          const perm = await handle.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') {
            throw new Error('Permission to write denied by user.');
          }
        }

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = saveFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      await setDocumentCache(saveFilename, this.currentFileHandle);
      showToast(`${saveFilename} saved successfully!`, 'success');
    } catch (e) {
      console.error('Save failed:', e);
      showToast(`Failed to save ${saveFilename}.`, 'error');
    }
  }

  private async loadCachedImage() {
    try {
      const cache = await getDocumentCache();
      if (cache && cache.fileHandle) {
        const attemptLoad = async (interactive = false) => {
          try {
            let perm = await cache.fileHandle.queryPermission({ mode: 'read' });
            if (perm !== 'granted') {
              perm = await cache.fileHandle.requestPermission({ mode: 'read' });
            }
            if (perm === 'granted') {
              showToast(`Restoring ${cache.filename}...`);
              const file = await cache.fileHandle.getFile();
              if (file.name.toLowerCase().endsWith('.psd')) {
                // If it was an old PSD, skip auto restore
                return false;
              }
              this.currentFileHandle = cache.fileHandle;
              await this.processFile(file);
              showToast(`${cache.filename} restored.`);
              return true;
            }
          } catch (e) {
            if (interactive) {
              console.error('Failed to restore file interactively', e);
              showToast(`Please open ${cache.filename} manually.`, 'error');
            }
          }
          return false;
        };

        const success = await attemptLoad(false);
        if (!success) {
          const onClick = async () => {
            document.removeEventListener('click', onClick, true);
            await attemptLoad(true);
          };
          document.addEventListener('click', onClick, true);
        }
      }
    } catch (e) {
      console.error('Failed to load cached image', e);
    }
  }

  public static getInstance(): DocumentManager {
    if (!DocumentManager.instance) {
      DocumentManager.instance = new DocumentManager();
    }
    return DocumentManager.instance;
  }

  private async handleFileNew() {
    if (this.currentCanvas) {
      const confirmClose = window.confirm('変更内容を保存しましたか？保存していない内容は失われます。\n\n新しい画像を作成してもよろしいですか？');
      if (!confirmClose) return;
    }

    const filename = 'Untitled.png';
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 1024, 1024);
    }

    this.currentCanvas = canvas;
    this.currentFilename = filename;
    this.currentFileHandle = null;

    try {
      await setDocumentCache(filename, null);
    } catch (e) {
      console.error('Error saving new image to cache', e);
    }

    window.dispatchEvent(new CustomEvent('document:loaded', {
      detail: {
        canvas,
        image: canvas,
        filename,
        width: 1024,
        height: 1024,
        psd: { width: 1024, height: 1024, children: [] }
      }
    }));
    showToast('新しい画像を作成しました', 'success');
  }

  private async handleFileClose() {
    if (!this.currentCanvas) return;

    const confirmClose = window.confirm('変更内容を保存しましたか？保存していない内容は失われます。\n\n画像を閉じてもよろしいですか？');
    if (!confirmClose) return;

    this.currentCanvas = null;
    this.currentFilename = null;
    this.currentFileHandle = null;
    window.dispatchEvent(new Event('document:closed'));
    showToast('画像を閉じました');
  }

  private async handleFileOpen() {
    if (this.currentCanvas) {
      const confirmClose = window.confirm('変更内容を保存しましたか？保存していない内容は失われます。\n\n新しいファイルを開いてもよろしいですか？');
      if (!confirmClose) return;
    }

    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await (window as any).showOpenFilePicker({
          types: [{
            description: 'Image Files',
            accept: {
              'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']
            },
          }],
        });
        const file = await fileHandle.getFile();
        this.currentFileHandle = fileHandle;
        await this.processFile(file);
      } catch (err: any) {
        if (err.name !== 'AbortError') console.warn('showOpenFilePicker failed:', err);
      }
    } else {
      this.fileInput.click();
    }
  }

  private async handleFileOpenRecent(event: CustomEvent<{ handle?: any, filename: string }>) {
    const { handle, filename } = event.detail;
    if (filename.toLowerCase().endsWith('.psd')) {
      showToast('PSD files are no longer supported. Please open an image file.', 'error');
      return;
    }
    if (handle && 'queryPermission' in handle) {
      await this.openFileFromHandle(handle, filename);
    } else {
      showToast(`Cannot open ${filename} directly. Please use Open Image.`);
    }
  }

  public async openFileFromHandle(handle: any, fallbackName?: string) {
    if (this.currentCanvas) {
      const confirmClose = window.confirm('変更内容を保存しましたか？保存していない内容は失われます。\n\n新しいファイルを開いてもよろしいですか？');
      if (!confirmClose) return;
    }

    try {
      if ((await handle.queryPermission({ mode: 'read' })) !== 'granted') {
        const perm = await handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') {
          showToast('Permission to read file denied.', 'error');
          return;
        }
      }
      const file = await handle.getFile();
      if (file.name.toLowerCase().endsWith('.psd')) {
        showToast('PSD files are no longer supported. Please open an image file.', 'error');
        return;
      }
      this.currentFileHandle = handle;
      await this.processFile(file);
    } catch (err: any) {
      console.warn('Failed to open recent file from handle:', err);
      showToast(`Failed to open recent file: ${fallbackName || 'Unknown'}`, 'error');
    }
  }

  private async handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    const file = target.files[0];
    this.currentFileHandle = null;
    await this.processFile(file);

    target.value = '';
  }

  public async processFile(file: File) {
    if (file.name.toLowerCase().endsWith('.psd')) {
      showToast('PSDファイルの読み込みは廃止されました。画像ファイル（PNG/JPG等）を選択してください。', 'error');
      return;
    }

    showToast(`Loading ${file.name}...`);

    try {
      let imageBitmap: ImageBitmap | HTMLImageElement;
      let width = 0;
      let height = 0;

      if ('createImageBitmap' in window) {
        imageBitmap = await createImageBitmap(file);
        width = imageBitmap.width;
        height = imageBitmap.height;
      } else {
        const img = new Image();
        const url = URL.createObjectURL(file);
        await new Promise((resolve, reject) => {
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
        URL.revokeObjectURL(url);
        imageBitmap = img;
        width = img.naturalWidth || img.width;
        height = img.naturalHeight || img.height;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');
      ctx.drawImage(imageBitmap, 0, 0);

      this.currentCanvas = canvas;
      this.currentFilename = file.name;

      await setDocumentCache(file.name, this.currentFileHandle);
      await addRecentFile(file.name, this.currentFileHandle);

      showToast(`${file.name} loaded successfully!`, 'success');

      window.dispatchEvent(new CustomEvent('document:loaded', {
        detail: {
          canvas,
          image: canvas,
          filename: file.name,
          width,
          height,
          psd: { width, height, children: [] }
        }
      }));
      window.dispatchEvent(new Event('document:redraw'));
    } catch (error) {
      console.error('Error loading image:', error);
      showToast('Error loading image file.', 'error');
    }
  }

  public getCurrentCanvas(): HTMLCanvasElement | null {
    return this.currentCanvas;
  }

  public getCurrentImage(): HTMLCanvasElement | null {
    return this.currentCanvas;
  }

  public getCurrentPsd(): any {
    if (!this.currentCanvas) return null;
    return {
      width: this.currentCanvas.width,
      height: this.currentCanvas.height,
      children: []
    };
  }

  public getCurrentFilename(): string | null {
    return this.currentFilename;
  }

  public getCurrentSelectedLayer(): any {
    return null;
  }

  public async setCanvas(canvas: HTMLCanvasElement, filename?: string): Promise<void> {
    this.currentCanvas = canvas;
    if (filename) this.currentFilename = filename;
    window.dispatchEvent(new CustomEvent('document:loaded', {
      detail: {
        canvas,
        image: canvas,
        filename: this.currentFilename || 'Untitled.png',
        width: canvas.width,
        height: canvas.height,
        psd: { width: canvas.width, height: canvas.height, children: [] }
      }
    }));
    window.dispatchEvent(new Event('document:redraw'));
  }

  public async addLayerAndSave(newLayer: any): Promise<void> {
    // Kept for interface compatibility
    if (newLayer && newLayer.canvas) {
      await this.setCanvas(newLayer.canvas);
    }
  }
}

export function initDocumentManager() {
  DocumentManager.getInstance();
}
