import { readPsd, type Psd } from 'ag-psd';
import { showToast } from '../../shared/utils/toast';
import { setPsdCache, getPsdCache } from '../../shared/utils/idb';

export class DocumentManager {
  private static instance: DocumentManager;
  private currentPsd: Psd | null = null;
  private currentFilename: string | null = null;
  private fileInput: HTMLInputElement;

  private constructor() {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.psd';
    this.fileInput.style.display = 'none';
    document.body.appendChild(this.fileInput);

    this.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
    window.addEventListener('file:open', () => this.fileInput.click());
    
    // Load cached PSD on startup
    this.loadCachedPsd();
  }

  private async loadCachedPsd() {
    try {
      const cache = await getPsdCache();
      if (cache) {
        showToast(`Restoring ${cache.filename}...`);
        const psd = readPsd(cache.buffer);
        this.currentPsd = psd;
        this.currentFilename = cache.filename;
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

  private async handleFileSelect(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) return;

    const file = target.files[0];
    showToast(`Loading ${file.name}...`);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      
      // Save a copy to cache before parsing to avoid any detachment issues
      const bufferCopy = arrayBuffer.slice(0);
      await setPsdCache(file.name, bufferCopy);

      // ag-psd expects a Uint8Array or ArrayBuffer
      const psd = readPsd(arrayBuffer);
      
      this.currentPsd = psd;
      this.currentFilename = file.name;
      console.log('PSD loaded successfully:', psd);
      
      showToast(`${file.name} loaded successfully!`);
      
      // Dispatch an event so other components (Canvas, LayerPanel) can react
      window.dispatchEvent(new CustomEvent('document:loaded', { 
        detail: { psd, filename: file.name } 
      }));
    } catch (error) {
      console.error('Error loading PSD:', error);
      showToast('Error loading PSD file.');
    } finally {
      // Reset the input so the same file can be selected again if needed
      target.value = '';
    }
  }

  public getCurrentPsd(): Psd | null {
    return this.currentPsd;
  }
}

// Automatically initialize when imported if needed, 
// or explicitly called in app.ts
export function initDocumentManager() {
  DocumentManager.getInstance();
}
