import { readPsd, writePsd, type Psd } from 'ag-psd';
import { showToast } from '../../shared/utils/toast';
import { setPsdCache, getPsdCache, addRecentFile } from '../../shared/utils/idb';

export class DocumentManager {
  private static instance: DocumentManager;
  private currentPsd: Psd | null = null;
  private currentFilename: string | null = null;
  private currentFileHandle: any = null;
  private fileInput: HTMLInputElement;
  private currentSelectedLayer: import('ag-psd').Layer | null = null;

  private constructor() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.psd';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);

    this.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
    window.addEventListener('file:new', this.handleFileNew.bind(this));
    window.addEventListener('file:open', this.handleFileOpen.bind(this));
    window.addEventListener('file:save', () => this.handleFileSave(false));
    window.addEventListener('file:save-as', () => this.handleFileSave(true));
    window.addEventListener('file:close', this.handleFileClose.bind(this));
    window.addEventListener('file:open-recent', this.handleFileOpenRecent.bind(this) as EventListener);
    window.addEventListener('layer:selected', this.handleLayerSelected.bind(this) as EventListener);
    
    // Load cached PSD on startup
    this.loadCachedPsd();
  }

  private handleLayerSelected(event: CustomEvent<{ layer: import('ag-psd').Layer | null }>) {
    this.currentSelectedLayer = event.detail.layer;
  }

  private extractLayerState(layers: any[]): any[] {
    const state: any[] = [];
    for (const layer of layers) {
      if (layer.id !== undefined) {
        state.push({
          id: layer.id,
          visible: !layer.hidden,
          opacity: layer.opacity
        });
      }
      if (layer.children) {
        state.push(...this.extractLayerState(layer.children));
      }
    }
    return state;
  }

  private async handleFileSave(isSaveAs: boolean = false) {
    if (!this.currentPsd || !this.currentFilename) {
      showToast('No PSD loaded to save.');
      return;
    }

    let saveFilename = this.currentFilename;
    let fileHandle: FileSystemFileHandle | null = isSaveAs ? null : this.currentFileHandle;

    // Use File System Access API if available
    if ((isSaveAs || !fileHandle) && 'showSaveFilePicker' in window) {
      try {
        const options: any = {
          suggestedName: this.currentFilename,
          types: [
            {
              description: 'Photoshop Document',
              accept: { 'image/vnd.adobe.photoshop': ['.psd'] },
            },
            {
              description: 'ZIP Archive (Layers as PNG)',
              accept: { 'application/zip': ['.zip'] },
            }
          ],
        };
        if (this.currentFileHandle) {
          options.startIn = this.currentFileHandle;
        }
        fileHandle = await (window as any).showSaveFilePicker(options);
        if (fileHandle) {
          saveFilename = (fileHandle as any).name;
          if (saveFilename.toLowerCase().endsWith('.psd')) {
            this.currentFilename = saveFilename;
            this.currentFileHandle = fileHandle; // Save the new handle
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return; // User cancelled
        console.warn('showSaveFilePicker failed:', err);
      }
    } else if (isSaveAs) {
      // Fallback for browsers without File System Access API
      let newName = prompt('Enter new file name (end with .psd or .zip):', this.currentFilename);
      if (!newName) return; // User cancelled
      if (!newName.toLowerCase().endsWith('.psd') && !newName.toLowerCase().endsWith('.zip')) {
        newName += '.psd';
      }
      saveFilename = newName;
      if (saveFilename.toLowerCase().endsWith('.psd')) {
        this.currentFilename = saveFilename;
      }
    }

    showToast(`Saving ${saveFilename}...`);
    
    try {
      let resultBlob: Blob;

      if (saveFilename.toLowerCase().endsWith('.psd')) {
        // Save locally using ag-psd
        const arrayBuffer = writePsd(this.currentPsd);
        resultBlob = new Blob([arrayBuffer], { type: 'application/vnd.adobe.photoshop' });
      } else {
        // Fallback to backend for ZIP exports
        const cache = await getPsdCache();
        if (!cache) {
          showToast('Error: Original file not found in cache.', 'error');
          return;
        }
        
        const layerStates = this.extractLayerState(this.currentPsd.children || []);
        
        const formData = new FormData();
        const blob = new Blob([cache.buffer], { type: 'application/octet-stream' });
        formData.append('file', blob, saveFilename);
        formData.append('state', JSON.stringify(layerStates));
        
        const response = await fetch('http://localhost:8000/api/psd/save', {
          method: 'POST',
          body: formData
        });
        
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
        
        resultBlob = await response.blob();
      }

      if (fileHandle) {
        // Request write permission if not already granted
        const handle = fileHandle as any;
        if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
          const perm = await handle.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') {
            throw new Error('Permission to write denied by user.');
          }
        }
        
        // Write directly to the file chosen by the user
        const writable = await handle.createWritable();
        await writable.write(resultBlob);
        await writable.close();
      } else {
        // Fallback: download via <a> tag (saves to default Downloads folder)
        const url = URL.createObjectURL(resultBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = saveFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      
      showToast(`${saveFilename} saved successfully!`, 'success');
    } catch (e) {
      console.error('Save failed:', e);
      showToast(`Failed to save ${saveFilename}.`, 'error');
    }
  }

  private sanitizePsd(psd: Psd) {
    if (psd.children && psd.children.length === 1) {
      const dummy = psd.children[0];
      if (
        !dummy.name &&
        dummy.top === 0 && dummy.bottom === 0 && dummy.left === 0 && dummy.right === 0 &&
        !dummy.canvas && !dummy.imageData
      ) {
        psd.children = [];
      }
    }
  }

  private async loadCachedPsd() {
    try {
      const cache = await getPsdCache();
      if (cache) {
        showToast(`Restoring ${cache.filename}...`);
        const psd = readPsd(cache.buffer);
        this.sanitizePsd(psd);
        this.currentPsd = psd;
        this.currentFilename = cache.filename;
        if (cache.fileHandle) {
          this.currentFileHandle = cache.fileHandle;
        }
        window.dispatchEvent(new CustomEvent('document:loaded', { 
          detail: { psd, filename: cache.filename } 
        }));
        showToast(`${cache.filename} restored.`);
      }
    } catch (e) {
      console.error('Failed to load cached PSD', e);
    }
  }

  public static getInstance(): DocumentManager {
    if (!DocumentManager.instance) {
      DocumentManager.instance = new DocumentManager();
    }
    return DocumentManager.instance;
  }

  private async handleFileNew() {
    if (this.currentPsd) {
      const confirmClose = window.confirm('変更内容を保存しましたか？保存していない内容は失われます。\n\n新しいPSDを作成してもよろしいですか？');
      if (!confirmClose) return;
    }

    const filename = 'Untitled.psd';
    
    const rootPsd: Psd = {
      width: 1024,
      height: 1024,
      channels: 3,
      bitsPerChannel: 8,
      colorMode: 3,
      children: []
    };
    
    this.currentPsd = rootPsd;
    this.currentFilename = filename;
    this.currentFileHandle = null;
    this.currentSelectedLayer = null;
    
    try {
      const buffer = writePsd(rootPsd);
      await setPsdCache(filename, buffer, null);
    } catch (e) {
      console.error('Error saving new psd to cache', e);
    }
    
    window.dispatchEvent(new CustomEvent('document:loaded', {
      detail: { psd: rootPsd, filename }
    }));
    showToast('新しいPSDを作成しました', 'success');
  }

  private async handleFileClose() {
    if (!this.currentPsd) return;

    const confirmClose = window.confirm('変更内容を保存しましたか？保存していない内容は失われます。\n\nPSDを閉じてもよろしいですか？');
    if (!confirmClose) return;

    this.currentPsd = null;
    this.currentFilename = null;
    this.currentFileHandle = null;
    this.currentSelectedLayer = null;
    window.dispatchEvent(new Event('document:closed'));
    showToast('PSDを閉じました');
  }

  private async handleFileOpen() {
    if (this.currentPsd) {
      const confirmClose = window.confirm('変更内容を保存しましたか？保存していない内容は失われます。\n\n新しいファイルを開いてもよろしいですか？');
      if (!confirmClose) return;
    }

    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await (window as any).showOpenFilePicker({
          types: [{
            description: 'Photoshop Document',
            accept: { 'image/vnd.adobe.photoshop': ['.psd'] },
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
    if (handle && 'queryPermission' in handle) {
      await this.openFileFromHandle(handle, filename);
    } else {
      showToast(`Cannot open ${filename} directly. Please use Open PSD.`);
    }
  }

  public async openFileFromHandle(handle: any, fallbackName?: string) {
    if (this.currentPsd) {
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
    this.currentFileHandle = null; // Clear handle since we used standard input
    await this.processFile(file);
    
    // Reset the input so the same file can be selected again if needed
    target.value = '';
  }

  private async processFile(file: File) {
    showToast(`Loading ${file.name}...`);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      
      // Save a copy to cache before parsing to avoid any detachment issues
      const bufferCopy = arrayBuffer.slice(0);
      await setPsdCache(file.name, bufferCopy, this.currentFileHandle);
      await addRecentFile(file.name, this.currentFileHandle);

      // ag-psd expects a Uint8Array or ArrayBuffer
      const psd = readPsd(arrayBuffer);
      this.sanitizePsd(psd);
      
      this.currentPsd = psd;
      this.currentFilename = file.name;
      console.log('PSD loaded successfully:', psd);
      
      showToast(`${file.name} loaded successfully!`, 'success');
      
      // Dispatch an event so other components (Canvas, LayerPanel) can react
      window.dispatchEvent(new CustomEvent('document:loaded', { 
        detail: { psd, filename: file.name } 
      }));
    } catch (error) {
      console.error('Error loading PSD:', error);
      showToast('Error loading PSD file.', 'error');
    }
  }

  public getCurrentPsd(): Psd | null {
    return this.currentPsd;
  }

  public getCurrentSelectedLayer(): import('ag-psd').Layer | null {
    return this.currentSelectedLayer;
  }

  public async addLayerAndSave(newLayer: import('ag-psd').Layer): Promise<void> {
    if (!this.currentPsd || !this.currentFilename) return;

    if (!this.currentPsd.children) {
      this.currentPsd.children = [];
    }

    // Insert just above the selected layer if exists, else at top
    let insertIndex = 0;
    if (this.currentSelectedLayer) {
      const idx = this.currentPsd.children.indexOf(this.currentSelectedLayer);
      if (idx !== -1) {
        insertIndex = idx; // Insert before it (which visually is above it in typical Top-Down rendering)
      }
    }

    this.currentPsd.children.splice(insertIndex, 0, newLayer);

    // Write to buffer and update cache
    const arrayBuffer = writePsd(this.currentPsd);
    await setPsdCache(this.currentFilename, arrayBuffer, this.currentFileHandle);

    // Notify others
    window.dispatchEvent(new CustomEvent('document:loaded', {
      detail: { psd: this.currentPsd, filename: this.currentFilename }
    }));
    window.dispatchEvent(new Event('document:redraw'));
  }
}

// Automatically initialize when imported if needed, 
// or explicitly called in app.ts
export function initDocumentManager() {
  DocumentManager.getInstance();
}
