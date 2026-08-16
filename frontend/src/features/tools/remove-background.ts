import { Tool, ToolContext } from '../../shared/types/tool.types';
import { saveArchive } from '../../shared/utils/archives';
import { getGlobalSetting, setGlobalSetting } from '../../shared/utils/settings';

export class RemoveBackgroundTool implements Tool {
  id = 'remove-background';
  name = 'Remove Background';
  icon = '';
  hasSettings = true;
  executeLabel = '背景除去する';
  executeIcon = null;

  private getSetting(key: string, defaultValue: string): string {
    return getGlobalSetting(`removeBg_${key}`, defaultValue);
  }

  private setSetting(key: string, value: string): void {
    setGlobalSetting(`removeBg_${key}`, value);
  }

  renderSettings(container: HTMLElement): void {
    const updaters: (() => void)[] = [];

    const createField = (label: string, helpText: string, element: HTMLElement) => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '4px';
      wrapper.style.marginBottom = '12px';
      
      const lblContainer = document.createElement('div');
      lblContainer.style.display = 'flex';
      lblContainer.style.alignItems = 'center';
      lblContainer.style.gap = '4px';

      const lbl = document.createElement('label');
      lbl.textContent = label;
      lbl.style.fontSize = '12px';
      lbl.style.color = 'var(--color-on-surface-variant)';
      
      lblContainer.appendChild(lbl);
      
      if (helpText) {
        const helpIcon = document.createElement('span');
        helpIcon.className = 'material-symbols-outlined';
        helpIcon.textContent = 'help';
        helpIcon.style.fontSize = '14px';
        helpIcon.style.color = 'var(--color-on-surface-variant)';
        helpIcon.style.cursor = 'help';
        helpIcon.title = helpText;
        lblContainer.appendChild(helpIcon);
      }
      
      wrapper.appendChild(lblContainer);
      wrapper.appendChild(element);
      return wrapper;
    };

    const createSlider = (label: string, helpText: string, key: string, min: string, max: string, defaultVal: string) => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '8px';
      
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = min;
      slider.max = max;
      slider.value = this.getSetting(key, defaultVal);
      slider.style.flex = '1';
      
      const valDisplay = document.createElement('span');
      valDisplay.textContent = slider.value;
      valDisplay.style.fontSize = '12px';
      valDisplay.style.width = '24px';
      valDisplay.style.textAlign = 'right';
      
      slider.addEventListener('input', () => {
        valDisplay.textContent = slider.value;
        this.setSetting(key, slider.value);
      });
      
      wrapper.appendChild(slider);
      wrapper.appendChild(valDisplay);
      
      updaters.push(() => {
        slider.value = defaultVal;
        valDisplay.textContent = defaultVal;
        this.setSetting(key, defaultVal);
      });

      return createField(label, helpText, wrapper);
    };

    // Alpha Matting Toggle
    const amWrapper = document.createElement('div');
    amWrapper.style.display = 'flex';
    amWrapper.style.alignItems = 'center';
    amWrapper.style.gap = '8px';
    amWrapper.style.marginBottom = '12px';
    
    let isAlphaMattingEnabled = this.getSetting('alpha_matting', 'true') === 'true';

    const amToggle = document.createElement('div');
    amToggle.className = `toggle ${isAlphaMattingEnabled ? 'toggle--on' : 'toggle--off'}`;
    const amKnob = document.createElement('div');
    amKnob.className = 'toggle__knob';
    amToggle.appendChild(amKnob);
    
    const amLabelContainer = document.createElement('div');
    amLabelContainer.style.display = 'flex';
    amLabelContainer.style.alignItems = 'center';
    amLabelContainer.style.gap = '4px';

    const amLabel = document.createElement('label');
    amLabel.textContent = 'アルファマッチングを使用';
    amLabel.style.fontSize = '12px';
    amLabel.style.color = 'var(--color-on-surface)';
    amLabel.style.cursor = 'pointer';
    
    const amHelpIcon = document.createElement('span');
    amHelpIcon.className = 'material-symbols-outlined';
    amHelpIcon.textContent = 'help';
    amHelpIcon.style.fontSize = '14px';
    amHelpIcon.style.color = 'var(--color-on-surface-variant)';
    amHelpIcon.style.cursor = 'help';
    amHelpIcon.title = 'アルファマッチング（境界の透過処理）を有効にします。髪の毛など、境界が複雑な画像の切り抜き精度が向上します。無効にすると輪郭がくっきりと切り抜かれます。';

    amLabelContainer.appendChild(amLabel);
    amLabelContainer.appendChild(amHelpIcon);

    const toggleAm = () => {
      isAlphaMattingEnabled = !isAlphaMattingEnabled;
      amToggle.classList.toggle('toggle--on', isAlphaMattingEnabled);
      amToggle.classList.toggle('toggle--off', !isAlphaMattingEnabled);
      this.setSetting('alpha_matting', isAlphaMattingEnabled.toString());
    };

    amLabel.addEventListener('click', toggleAm);
    amToggle.addEventListener('click', toggleAm);

    updaters.push(() => {
      isAlphaMattingEnabled = true;
      amToggle.classList.toggle('toggle--on', true);
      amToggle.classList.toggle('toggle--off', false);
      this.setSetting('alpha_matting', 'true');
    });
    
    amWrapper.appendChild(amToggle);
    amWrapper.appendChild(amLabelContainer);
    
    container.appendChild(amWrapper);

    container.appendChild(createSlider('前景しきい値', '前景（残す部分）として判定されるしきい値です。値を下げるとより広い範囲が前景として残ります。', 'fg_threshold', '0', '255', '240'));
    container.appendChild(createSlider('背景しきい値', '背景（削除する部分）として判定されるしきい値です。値を上げるとより広い範囲が背景として削除されます。', 'bg_threshold', '0', '255', '10'));
    container.appendChild(createSlider('浸食サイズ', '前景の境界をどれだけ削るか（浸食させるか）を指定します。背景のフチが残ってしまう場合は値を上げてください。', 'erode_size', '0', '50', '10'));

    const resetBtn = document.createElement('button');
    resetBtn.textContent = '初期値へ戻す';
    resetBtn.style.marginTop = '16px';
    resetBtn.style.padding = '8px';
    resetBtn.style.width = '100%';
    resetBtn.style.backgroundColor = 'transparent';
    resetBtn.style.border = '1px solid var(--color-outline)';
    resetBtn.style.color = 'var(--color-on-surface)';
    resetBtn.style.borderRadius = '4px';
    resetBtn.style.cursor = 'pointer';
    resetBtn.style.fontSize = '12px';

    resetBtn.addEventListener('click', () => {
      updaters.forEach(update => update());
    });

    container.appendChild(resetBtn);
  }

  async execute(context: ToolContext): Promise<void> {
    // 選択中のレイヤーの画像、なければコンポジット画像を取得
    let targetCanvas = await context.getSelectedImage();
    let isComposite = false;
    
    if (!targetCanvas) {
      targetCanvas = await context.getCompositeImage();
      isComposite = true;
    }

    if (!targetCanvas) {
      throw new Error('No image available to process.');
    }

    // CanvasをBlobに変換
    const originBlob = await new Promise<Blob | null>(res => targetCanvas!.toBlob(res, 'image/png'));
    if (!originBlob) {
      throw new Error('Failed to extract image blob.');
    }

    // バックエンドへ送信
    const formData = new FormData();
    formData.append('image', originBlob, 'image.png');
    formData.append('alpha_matting', this.getSetting('alpha_matting', 'true'));
    formData.append('alpha_matting_foreground_threshold', this.getSetting('fg_threshold', '240'));
    formData.append('alpha_matting_background_threshold', this.getSetting('bg_threshold', '10'));
    formData.append('alpha_matting_erode_size', this.getSetting('erode_size', '10'));

    // CONFEITO_API_PORT (通常は48000か8000) で立ち上がっている想定だが
    // 開発サーバー等でプロキシされるため直接フェッチする (Viteがproxy設定しているはず)
    const response = await fetch('http://127.0.0.1:48000/api/image/remove-bg', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Background removal failed: ${errorText}`);
    }

    const resultBlob = await response.blob();

    // アーカイブ保存名の生成
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
    const folderName = `${dateStr}_${timeStr}_${this.id}`;

    const archiveFiles: {blob: Blob, path: string}[] = [];
    archiveFiles.push({blob: originBlob, path: 'origin.png'});
    archiveFiles.push({blob: resultBlob, path: 'nobg.png'});
    
    await saveArchive(folderName, archiveFiles);
    window.dispatchEvent(new Event('tool:cache-updated'));
  }
}
