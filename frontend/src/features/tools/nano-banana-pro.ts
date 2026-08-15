import { Tool, ToolContext } from '../../shared/types/tool.types';
import { showToast } from '../../shared/utils/toast';
import { createCacheFolder, moveCacheItem, setImageCache } from '../../shared/utils/idb';
import { DocumentManager } from '../document/DocumentManager';
import { icon } from '../../shared/utils/dom';

export class NanoBananaProTool implements Tool {
  id = 'nano-banana-pro';
  name = 'Nano Banana Pro';
  icon = 'auto_awesome';
  hasSettings = true;

  private buildPayloadFn?: () => Promise<any>;
  private globalImages: { file: File, zoneTitle: string, isImportant?: boolean }[] = [];

  private async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Retrieve setting or default
  private getSetting(key: string, defaultValue: string): string {
    return localStorage.getItem(`nanoBananaPro_${key}`) || defaultValue;
  }

  // Set setting
  private setSetting(key: string, value: string): void {
    localStorage.setItem(`nanoBananaPro_${key}`, value);
  }

  renderSettings(container: HTMLElement): void {
    const createField = (label: string, element: HTMLElement) => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '4px';
      
      const lbl = document.createElement('label');
      lbl.textContent = label;
      lbl.style.fontSize = '12px';
      lbl.style.color = 'var(--color-on-surface-variant)';
      
      wrapper.appendChild(lbl);
      wrapper.appendChild(element);
      return wrapper;
    };
    
    // --- Input (Prompt) ---
    const promptHeader = document.createElement('div');
    promptHeader.style.display = 'flex';
    promptHeader.style.justifyContent = 'space-between';
    promptHeader.style.alignItems = 'center';
    
    const promptLabel = document.createElement('label');
    promptLabel.textContent = 'プロンプト';
    promptLabel.style.fontSize = '12px';
    promptLabel.style.color = 'var(--color-on-surface-variant)';
    
    const editBtn = document.createElement('button');
    editBtn.appendChild(icon('edit', 14));
    editBtn.style.background = 'none';
    editBtn.style.border = 'none';
    editBtn.style.color = 'var(--color-on-surface-variant)';
    editBtn.style.cursor = 'pointer';
    editBtn.style.padding = '4px';
    editBtn.style.display = 'flex';
    editBtn.style.alignItems = 'center';
    editBtn.style.justifyContent = 'center';
    editBtn.title = 'デフォルトプロンプトを編集';
    
    promptHeader.appendChild(promptLabel);
    promptHeader.appendChild(editBtn);

    const defaultPrompt = this.getSetting('defaultPrompt', 'この画像を元に、形状・構造・線画をできるだけ正確に維持したまま着彩して。線や輪郭、構図は一切変更せず、色のみを追加すること。');

    const promptInput = document.createElement('textarea');
    promptInput.value = this.getSetting('prompt', defaultPrompt);
    promptInput.placeholder = defaultPrompt;
    promptInput.style.padding = '8px';
    promptInput.style.borderRadius = '4px';
    promptInput.style.border = '1px solid var(--color-outline)';
    promptInput.style.backgroundColor = 'var(--color-surface-container-lowest)';
    promptInput.style.color = 'var(--color-on-surface)';
    promptInput.style.height = '240px';
    promptInput.style.resize = 'vertical';

    editBtn.addEventListener('click', () => {
      // Create Modal Window
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100vw';
      overlay.style.height = '100vh';
      overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '10000';

      const modal = document.createElement('div');
      modal.style.backgroundColor = 'var(--color-surface-container-high)';
      modal.style.padding = '16px';
      modal.style.borderRadius = '8px';
      modal.style.width = '400px';
      modal.style.display = 'flex';
      modal.style.flexDirection = 'column';
      modal.style.gap = '12px';
      modal.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';

      const title = document.createElement('h3');
      title.textContent = 'デフォルトプロンプト';
      title.style.margin = '0';
      title.style.fontSize = '14px';
      title.style.color = 'var(--color-on-surface)';

      const input = document.createElement('textarea');
      input.value = this.getSetting('defaultPrompt', 'この画像を元に、形状・構造・線画をできるだけ正確に維持したまま着彩して。線や輪郭、構図は一切変更せず、色のみを追加すること。');
      input.style.width = '100%';
      input.style.height = '240px';
      input.style.padding = '8px';
      input.style.borderRadius = '4px';
      input.style.border = '1px solid var(--color-outline)';
      input.style.backgroundColor = 'var(--color-surface-container-lowest)';
      input.style.color = 'var(--color-on-surface)';
      input.style.resize = 'vertical';

      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.justifyContent = 'flex-end';
      btnRow.style.gap = '8px';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'キャンセル';
      cancelBtn.style.padding = '6px 12px';
      cancelBtn.style.borderRadius = '4px';
      cancelBtn.style.border = '1px solid var(--color-outline)';
      cancelBtn.style.background = 'transparent';
      cancelBtn.style.color = 'var(--color-on-surface)';
      cancelBtn.style.cursor = 'pointer';

      const saveBtn = document.createElement('button');
      saveBtn.textContent = '保存';
      saveBtn.style.padding = '6px 12px';
      saveBtn.style.borderRadius = '4px';
      saveBtn.style.border = 'none';
      saveBtn.style.background = 'var(--color-primary)';
      saveBtn.style.color = 'var(--color-on-primary)';
      saveBtn.style.cursor = 'pointer';

      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
      });

      saveBtn.addEventListener('click', () => {
        this.setSetting('defaultPrompt', input.value);
        if (promptInput.value === this.getSetting('prompt', '')) {
            // If user hasn't modified current prompt yet, update it
            promptInput.value = input.value;
            this.setSetting('prompt', input.value);
        }
        promptInput.placeholder = input.value;
        document.body.removeChild(overlay);
      });

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(saveBtn);

      modal.appendChild(title);
      modal.appendChild(input);
      modal.appendChild(btnRow);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      input.focus();
    });
    promptInput.addEventListener('input', () => this.setSetting('prompt', promptInput.value));
    
    const promptWrapper = document.createElement('div');
    promptWrapper.style.display = 'flex';
    promptWrapper.style.flexDirection = 'column';
    promptWrapper.style.gap = '4px';
    promptWrapper.appendChild(promptHeader);
    promptWrapper.appendChild(promptInput);
    
    container.appendChild(promptWrapper);

    // --- Image References ---
    const dropZones: { updateUI: () => void }[] = [];

    const updateAllDropZones = () => {
      dropZones.forEach(dz => dz.updateUI());
    };

    const createImageDropZone = (title: string, max: number) => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '4px';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      
      const titleWrapper = document.createElement('div');
      titleWrapper.style.display = 'flex';
      titleWrapper.style.alignItems = 'center';
      titleWrapper.style.gap = '4px';

      const lbl = document.createElement('label');
      lbl.textContent = title;
      lbl.style.fontSize = '12px';
      lbl.style.color = 'var(--color-on-surface-variant)';

      const helpIcon = document.createElement('span');
      helpIcon.className = 'material-symbols-outlined';
      helpIcon.textContent = 'help';
      helpIcon.style.display = 'inline-flex';
      helpIcon.style.alignItems = 'center';
      helpIcon.style.justifyContent = 'center';
      helpIcon.style.fontSize = '14px';
      helpIcon.style.color = 'var(--color-on-surface-variant)';
      helpIcon.style.cursor = 'help';
      
      let helpText = '';
      if (title.includes('Object')) helpText = '例: 線画、衣装のデザイン画、特定のアイテム(剣や帽子)など、形やディテールを変えたくない画像を入れます。';
      if (title.includes('Character')) helpText = '例: キャラクターの三面図、顔のアップなど、人物のアイデンティティを固定したい画像を入れます。';
      if (title.includes('Style')) helpText = '例: 参考にするイラストレーターの絵、完成形の塗り方の参考画像など、画風を適用したい画像を入れます。';
      helpIcon.title = helpText;

      titleWrapper.appendChild(lbl);
      titleWrapper.appendChild(helpIcon);
      
      const count = document.createElement('span');
      count.textContent = `0 / ${max}`;
      count.style.fontSize = '11px';
      count.style.color = 'var(--color-outline)';
      
      const headerRight = document.createElement('div');
      headerRight.style.display = 'flex';
      headerRight.style.gap = '8px';
      headerRight.style.alignItems = 'center';

      const addCanvasBtn = document.createElement('button');
      addCanvasBtn.textContent = 'キャンバス追加';
      addCanvasBtn.style.fontSize = '10px';
      addCanvasBtn.style.padding = '2px 6px';
      addCanvasBtn.style.borderRadius = '4px';
      addCanvasBtn.style.background = 'var(--color-surface-container-high)';
      addCanvasBtn.style.border = '1px solid var(--color-outline-variant)';
      addCanvasBtn.style.color = 'var(--color-on-surface)';
      addCanvasBtn.style.cursor = 'pointer';
      
      addCanvasBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        // The actual logic is attached further down after handleFiles is defined.
      });

      // We will attach the click handler logic dynamically after handleFiles is defined.
      
      headerRight.appendChild(addCanvasBtn);
      headerRight.appendChild(count);
      
      header.appendChild(titleWrapper);
      header.appendChild(headerRight);
      
      const dropArea = document.createElement('div');
      dropArea.style.border = '1px dashed var(--color-outline-variant)';
      dropArea.style.borderRadius = '4px';
      dropArea.style.padding = '12px';
      dropArea.style.textAlign = 'center';
      dropArea.style.color = 'var(--color-on-surface-variant)';
      dropArea.style.fontSize = '11px';
      dropArea.style.cursor = 'pointer';
      dropArea.style.display = 'flex';
      dropArea.style.flexWrap = 'wrap';
      dropArea.style.gap = '8px';
      dropArea.style.justifyContent = 'center';
      dropArea.style.alignItems = 'center';
      dropArea.style.minHeight = '48px';
      dropArea.style.backgroundColor = 'var(--color-surface-container-lowest)';
      
      const placeholder = document.createElement('div');
      placeholder.textContent = 'クリック または 画像をドラッグ＆ドロップ';
      placeholder.style.pointerEvents = 'none';
      dropArea.appendChild(placeholder);
      
      // Hidden File Input
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.multiple = true;
      fileInput.style.display = 'none';

      wrapper.appendChild(header);
      wrapper.appendChild(dropArea);
      wrapper.appendChild(fileInput);
      
      const dropZoneApi = {
        updateUI: () => {} // assigned below
      };
      dropZones.push(dropZoneApi);

      dropZoneApi.updateUI = () => {
        const zoneImages = this.globalImages.filter(img => img.zoneTitle === title);
        
        count.textContent = `${zoneImages.length} / ${max}`;
        dropArea.innerHTML = '';
        if (zoneImages.length === 0) {
          dropArea.appendChild(placeholder);
        } else {
          zoneImages.forEach((item, _index) => {
            const file = item.file;
            const globalIndex = this.globalImages.indexOf(item);
            
            const thumb = document.createElement('div');
            thumb.style.position = 'relative';
            thumb.style.width = '48px';
            thumb.style.height = '48px';
            thumb.style.borderRadius = '4px';
            thumb.style.overflow = 'hidden';
            thumb.style.border = '1px solid var(--color-outline)';
            
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            
            const numBadge = document.createElement('div');
            numBadge.textContent = String(globalIndex + 1);
            numBadge.style.position = 'absolute';
            numBadge.style.top = '2px';
            numBadge.style.left = '2px';
            numBadge.style.width = '14px';
            numBadge.style.height = '14px';
            numBadge.style.background = 'rgba(0,0,0,0.6)';
            numBadge.style.color = '#fff';
            numBadge.style.fontSize = '10px';
            numBadge.style.fontWeight = 'bold';
            numBadge.style.borderRadius = '2px';
            numBadge.style.display = 'flex';
            numBadge.style.alignItems = 'center';
            numBadge.style.justifyContent = 'center';
            numBadge.style.lineHeight = '1';
            numBadge.style.pointerEvents = 'none';
            
            const starBtn = document.createElement('button');
            starBtn.innerHTML = '&#9733;'; // star
            starBtn.style.position = 'absolute';
            starBtn.style.bottom = '2px';
            starBtn.style.right = '2px';
            starBtn.style.width = '16px';
            starBtn.style.height = '16px';
            starBtn.style.background = 'rgba(0,0,0,0.6)';
            starBtn.style.color = item.isImportant ? 'gold' : '#ccc';
            starBtn.style.border = 'none';
            starBtn.style.borderRadius = '2px';
            starBtn.style.cursor = 'pointer';
            starBtn.style.fontSize = '12px';
            starBtn.style.lineHeight = '1';
            starBtn.style.display = 'flex';
            starBtn.style.alignItems = 'center';
            starBtn.style.justifyContent = 'center';
            starBtn.title = '重要画像に設定';

            starBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              item.isImportant = !item.isImportant;
              starBtn.style.color = item.isImportant ? 'gold' : '#ccc';
            });

            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '&times;';
            removeBtn.style.position = 'absolute';
            removeBtn.style.top = '2px';
            removeBtn.style.right = '2px';
            removeBtn.style.width = '16px';
            removeBtn.style.height = '16px';
            removeBtn.style.background = 'rgba(0,0,0,0.6)';
            removeBtn.style.color = '#fff';
            removeBtn.style.border = 'none';
            removeBtn.style.borderRadius = '50%';
            removeBtn.style.cursor = 'pointer';
            removeBtn.style.fontSize = '12px';
            removeBtn.style.lineHeight = '1';
            removeBtn.style.display = 'flex';
            removeBtn.style.alignItems = 'center';
            removeBtn.style.justifyContent = 'center';
            
            removeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const currentIndex = this.globalImages.indexOf(item);
              if (currentIndex !== -1) {
                this.globalImages.splice(currentIndex, 1);
              }
              updateAllDropZones();
            });

            thumb.appendChild(img);
            thumb.appendChild(numBadge);
            thumb.appendChild(starBtn);
            thumb.appendChild(removeBtn);
            dropArea.appendChild(thumb);
          });
          
          if (zoneImages.length < max) {
            const addMore = document.createElement('div');
            addMore.textContent = '+';
            addMore.style.width = '48px';
            addMore.style.height = '48px';
            addMore.style.display = 'flex';
            addMore.style.alignItems = 'center';
            addMore.style.justifyContent = 'center';
            addMore.style.border = '1px dashed var(--color-outline-variant)';
            addMore.style.borderRadius = '4px';
            addMore.style.cursor = 'pointer';
            addMore.style.fontSize = '24px';
            addMore.style.color = 'var(--color-outline-variant)';
            dropArea.appendChild(addMore);
          }
        }
      };

      const handleFiles = (files: FileList | File[]) => {
        const newImages = Array.from(files).filter(f => f.type.startsWith('image/'));
        const currentZoneImages = this.globalImages.filter(img => img.zoneTitle === title);
        const available = max - currentZoneImages.length;
        const added = newImages.slice(0, available);
        added.forEach(file => {
          this.globalImages.push({ file, zoneTitle: title });
        });
        updateAllDropZones();
      };
      
      // Attach the canvas to file logic here now that handleFiles is defined
      addCanvasBtn.addEventListener('click', () => {
        const docManager = DocumentManager.getInstance();
        const psd = docManager.getCurrentPsd();
        if (!psd || !psd.width || !psd.height) return;
        
        const canvas = document.createElement('canvas');
        canvas.width = psd.width;
        canvas.height = psd.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const drawNode = (node: any) => {
          if (node.hidden) return;
          if (node.children) {
            for (let i = node.children.length - 1; i >= 0; i--) {
              drawNode(node.children[i]);
            }
          } else if (node.canvas) {
            ctx.drawImage(node.canvas, node.left || 0, node.top || 0);
          }
        };

        if (psd.children) {
          for (let i = psd.children.length - 1; i >= 0; i--) {
            drawNode(psd.children[i]);
          }
        }
        
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `canvas_${Date.now()}.png`, { type: 'image/png' });
            handleFiles([file]);
          }
        }, 'image/png');
      });

      dropArea.addEventListener('click', () => fileInput.click());
      
      fileInput.addEventListener('change', () => {
        if (fileInput.files) {
          handleFiles(fileInput.files);
        }
        fileInput.value = ''; // Reset for same file re-selection
      });

      dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.style.borderColor = 'var(--color-primary)';
      });

      dropArea.addEventListener('dragleave', () => {
        dropArea.style.borderColor = 'var(--color-outline-variant)';
      });

      dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropArea.style.borderColor = 'var(--color-outline-variant)';
        if (e.dataTransfer?.files) {
          handleFiles(e.dataTransfer.files);
        }
      });

      return wrapper;
    };

    container.appendChild(createImageDropZone('高精度反映オブジェクト (Object)', 6));
    container.appendChild(createImageDropZone('キャラクター一貫性 (Character)', 5));
    container.appendChild(createImageDropZone('スタイル参照 (Style)', 3));

    // --- Aspect Ratio ---
    const arContainer = document.createElement('div');
    arContainer.style.display = 'grid';
    arContainer.style.gridTemplateColumns = 'repeat(5, 1fr)';
    arContainer.style.gap = '8px';

    let currentAr = this.getSetting('aspectRatio', '1:1');
    const arButtons: HTMLElement[] = [];
    const arOptions = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

    arOptions.forEach(opt => {
      const btn = document.createElement('button');
      btn.style.display = 'flex';
      btn.style.flexDirection = 'column';
      btn.style.alignItems = 'center';
      btn.style.justifyContent = 'center';
      btn.style.gap = '4px';
      btn.style.padding = '8px 4px';
      btn.style.borderRadius = '4px';
      btn.style.border = '1px solid var(--color-outline-variant)';
      btn.style.backgroundColor = currentAr === opt ? 'var(--color-surface-container-high)' : 'transparent';
      btn.style.color = currentAr === opt ? 'var(--color-primary)' : 'var(--color-on-surface-variant)';
      btn.style.cursor = 'pointer';

      const [wStr, hStr] = opt.split(':');
      const w = parseInt(wStr, 10);
      const h = parseInt(hStr, 10);
      
      const iconBox = document.createElement('div');
      const maxDim = 16;
      let boxW = maxDim, boxH = maxDim;
      if (w > h) {
        boxH = (h / w) * maxDim;
      } else {
        boxW = (w / h) * maxDim;
      }
      
      iconBox.style.width = `${boxW}px`;
      iconBox.style.height = `${boxH}px`;
      iconBox.style.border = `2px solid ${currentAr === opt ? 'var(--color-primary)' : 'var(--color-on-surface-variant)'}`;
      iconBox.style.borderRadius = '2px';
      
      const label = document.createElement('span');
      label.textContent = opt;
      label.style.fontSize = '11px';

      btn.appendChild(iconBox);
      btn.appendChild(label);
      
      btn.addEventListener('click', () => {
        currentAr = opt;
        this.setSetting('aspectRatio', opt);
        arButtons.forEach((b, i) => {
           const bOpt = arOptions[i];
           const isSelected = bOpt === currentAr;
           b.style.backgroundColor = isSelected ? 'var(--color-surface-container-high)' : 'transparent';
           b.style.color = isSelected ? 'var(--color-primary)' : 'var(--color-on-surface-variant)';
           const icon = b.firstChild as HTMLElement;
           icon.style.borderColor = isSelected ? 'var(--color-primary)' : 'var(--color-on-surface-variant)';
        });
        if (typeof (this as any).updateSizeOptions === 'function') {
           (this as any).updateSizeOptions();
        }
      });
      
      arButtons.push(btn);
      arContainer.appendChild(btn);
    });

    container.appendChild(createField('アスペクト比', arContainer));
    
    // --- Image Size ---
    const sizeSelect = document.createElement('select');
    sizeSelect.style.padding = '8px';
    sizeSelect.style.borderRadius = '4px';
    sizeSelect.style.border = '1px solid var(--color-outline)';
    sizeSelect.style.backgroundColor = 'var(--color-surface-container-lowest)';
    sizeSelect.style.color = 'var(--color-on-surface)';
    
    const calcDimensions = (arStr: string, sizeMode: string) => {
      const [w, h] = arStr.split(':').map(Number);
      const basePx = sizeMode === '1K' ? 1024 : sizeMode === '2K' ? 2048 : 4096;
      const totalPixels = basePx * basePx;
      const width = Math.round(Math.sqrt(totalPixels * (w / h)));
      const height = Math.round(Math.sqrt(totalPixels * (h / w)));
      // Snap to multiple of 8
      const snap = (val: number) => Math.round(val / 8) * 8;
      return { width: snap(width), height: snap(height) };
    };

    (this as any).updateSizeOptions = () => {
      const currentValue = sizeSelect.value || this.getSetting('imageSize', '1K');
      sizeSelect.innerHTML = '';
      const sizeModes = ['1K', '2K', '4K'];
      sizeModes.forEach(mode => {
        const dims = calcDimensions(currentAr, mode);
        const option = document.createElement('option');
        option.value = mode;
        option.textContent = `${mode} (${dims.width} x ${dims.height} px)`;
        sizeSelect.appendChild(option);
      });
      sizeSelect.value = currentValue;
    };

    (this as any).updateSizeOptions();

    sizeSelect.addEventListener('change', () => this.setSetting('imageSize', sizeSelect.value));
    container.appendChild(createField('画像サイズ', sizeSelect));

    // Restore images if they were already added (i.e. sidebar reopened)
    updateAllDropZones();

    // --- Mime Type ---
    const mimeSelect = document.createElement('select');
    mimeSelect.style.padding = '8px';
    mimeSelect.style.borderRadius = '4px';
    mimeSelect.style.border = '1px solid var(--color-outline)';
    mimeSelect.style.backgroundColor = 'var(--color-surface-container-lowest)';
    mimeSelect.style.color = 'var(--color-on-surface)';
    
    const mimeOptions = [
      { value: 'image/png', label: 'PNG' },
      { value: 'image/jpeg', label: 'JPEG' }
    ];
    mimeOptions.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      mimeSelect.appendChild(option);
    });
    const storedMime = this.getSetting('mimeType', 'image/png');
    mimeSelect.value = storedMime;
    mimeSelect.addEventListener('change', () => this.setSetting('mimeType', mimeSelect.value));
    container.appendChild(createField('保存形式', mimeSelect));

    // --- Note ---
    const note = document.createElement('div');
    note.textContent = '注意: 使用モデルは gemini-3-pro-image です。Thinkingプロセスは常時有効化されます。生成画像にはSynthID電子透かしが必ず付与されます。';
    note.style.fontSize = '11px';
    note.style.color = 'var(--color-on-surface-variant)';
    note.style.marginTop = '8px';
    note.style.padding = '8px';
    note.style.borderRadius = '4px';
    note.style.backgroundColor = 'var(--color-surface-container-high)';
    container.appendChild(note);

    // --- JSON Preview & Payload Builder ---
    this.buildPayloadFn = async () => {
      const input: any[] = [];
      let textPrompt = '';
      
      this.globalImages.forEach((item, index) => {
        const cleanTitle = item.zoneTitle.split(' (')[0];
        const importantStr = item.isImportant ? 'これはユーザにより重要画像に設定されている。\n' : '';
        textPrompt += `# Image ${index + 1}\nこの画像を${cleanTitle}画像とする。\n${importantStr}\n`;
      });
      
      for (const item of this.globalImages) {
        const base64 = await this.fileToBase64(item.file);
        const imagePayload: any = {
          type: 'image',
          mime_type: item.file.type || 'image/png',
          data: base64
        };
        input.push(imagePayload);
      }
      
      const defaultPrompt = this.getSetting('defaultPrompt', 'この画像を元に、形状・構造・線画をできるだけ正確に維持したまま着彩して。線や輪郭、構図は一切変更せず、色のみを追加すること。');
      const userPrompt = this.getSetting('prompt', defaultPrompt);
      const finalPrompt = userPrompt || defaultPrompt;
      textPrompt += `# User prompt\n${finalPrompt}`;
      
      input.push({
        type: 'text',
        text: textPrompt
      });
      
      return {
        model: 'gemini-3-pro-image',
        input: input,
        response_format: {
          type: 'image',
          mime_type: this.getSetting('mimeType', 'image/png'),
          aspect_ratio: this.getSetting('aspectRatio', '1:1'),
          image_size: this.getSetting('imageSize', '1K')
        }
      };
    };

    const previewBtn = document.createElement('button');
    previewBtn.textContent = 'JSONプレビュー';
    previewBtn.style.padding = '8px';
    previewBtn.style.borderRadius = '4px';
    previewBtn.style.background = 'var(--color-surface-container-high)';
    previewBtn.style.color = 'var(--color-on-surface)';
    previewBtn.style.border = '1px solid var(--color-outline-variant)';
    previewBtn.style.cursor = 'pointer';
    previewBtn.style.marginTop = '8px';
    previewBtn.style.width = '100%';
    previewBtn.style.fontSize = '12px';
    
    previewBtn.addEventListener('click', async () => {
       if (this.buildPayloadFn) {
         const payload = await this.buildPayloadFn();
         // Truncate base64 for display
         const displayPayload = JSON.parse(JSON.stringify(payload));
         if (displayPayload.input && displayPayload.input.length > 0) {
           displayPayload.input.forEach((p: any) => {
              if (p.type === 'image' && p.data) {
                  p.data = "BASE64_IMAGE_DATA";
              }
           });
         }
         
         const newWin = window.open('', '_blank', 'width=800,height=600');
         if (newWin) {
           newWin.document.write(`
             <html>
               <head>
                 <title>JSON Preview</title>
                 <style>
                   body { font-family: monospace; background: #1e1e1e; color: #d4d4d4; padding: 16px; margin: 0; }
                   pre { white-space: pre-wrap; word-wrap: break-word; }
                 </style>
               </head>
               <body>
                 <pre>${JSON.stringify(displayPayload, null, 2)}</pre>
               </body>
             </html>
           `);
           newWin.document.close();
         }
       }
    });
    
    container.appendChild(previewBtn);
  }

  async execute(context: ToolContext): Promise<void> {
    if (!this.buildPayloadFn) {
      throw new Error('設定画面が開かれていません。');
    }

    let progressInterval: number | undefined;
    try {
      const payload = await this.buildPayloadFn();
      
      const startTime = Date.now();
      progressInterval = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        window.dispatchEvent(new CustomEvent('tool:progress', {
          detail: { message: `Generating image... (${elapsed}s elapsed)` }
        }));
      }, 1000);

      const response = await fetch('http://127.0.0.1:8000/api/nano-banana-pro', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Provider': 'gemini'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let errorText = await response.text();
        try {
          const json = JSON.parse(errorText);
          if (json.detail) {
            errorText = typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail);
          }
        } catch (e) {}
        
        if (typeof errorText === 'string' && errorText.includes('GEMINI_API_KEY is not set')) {
          errorText = 'Gemini API Key が設定されていません。右上の設定アイコンから設定してください。';
        }
        throw new Error(errorText);
      }

      const blob = await response.blob();

      // --- Structured cache output ---
      const date = new Date();
      const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
      const stampedName = `${dateStr}_${timeStr}_${this.name}`;

      // 1) Create main folder
      const mainFolderId = await createCacheFolder(stampedName);

      // 2) Save generated image inside main folder
      const mimeType = payload.response_format?.mime_type || 'image/png';
      const ext = mimeType === 'image/jpeg' ? '.jpg' : '.png';
      await context.cacheResult(blob, this.id, { name: `${stampedName}${ext}`, folderId: mainFolderId });

      // 3) Create Inputs subfolder
      const inputsFolderId = await createCacheFolder('Inputs');
      await moveCacheItem(inputsFolderId, mainFolderId);

      // 4) Save reference images as Image1, Image2, ... inside Inputs
      for (let i = 0; i < this.globalImages.length; i++) {
        const item = this.globalImages[i];
        const imgBlob = item.file as Blob;
        const imgExt = (item.file.type || 'image/png').includes('jpeg') ? '.jpg' : '.png';
        await context.cacheResult(imgBlob, this.id, { name: `Image${i + 1}${imgExt}`, folderId: inputsFolderId });
      }

      // 5) Save payload.json inside Inputs
      const payloadForSave = JSON.parse(JSON.stringify(payload));
      if (payloadForSave.input) {
        payloadForSave.input.forEach((p: any) => {
          if (p.type === 'image' && p.data) {
            p.data = `[Image data omitted — see Image files in this folder]`;
          }
        });
      }
      const jsonBlob = new Blob([JSON.stringify(payloadForSave, null, 2)], { type: 'application/json' });
      const jsonKey = `ToolResult_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      await setImageCache(jsonKey, jsonBlob, 'payload.json', 'image', inputsFolderId);
      
      window.dispatchEvent(new Event('tool:cache-updated'));
      
    } catch (e: any) {
      console.error(e);
      throw e; // Rethrow to let AIPanel handle the error toast
    } finally {
      if (progressInterval) {
        window.clearInterval(progressInterval);
      }
    }
  }
}

