import { Tool, ToolContext } from '../../shared/types/tool.types';
import { DocumentManager } from '../document/DocumentManager';
import { showToast } from '../../shared/utils/toast';
import { getGlobalSetting, setGlobalSetting } from '../../shared/utils/settings';
import { icon } from '../../shared/utils/dom';

export class PanelSplitterTool implements Tool {
  id = 'panel-splitter';
  name = 'コマ分割';
  icon = 'auto_awesome';
  hasSettings = true;
  executeLabel = 'コマ分割を実行';
  executeIcon = 'auto_awesome';

  private getSetting(key: string, defaultValue: string): string {
    return getGlobalSetting(`panelSplitter_${key}`, defaultValue);
  }

  private setSetting(key: string, value: string): void {
    setGlobalSetting(`panelSplitter_${key}`, value);
  }

  renderSettings(container: HTMLElement): void {
    const updaters: (() => void)[] = [];

    // Helper: Field wrapper
    const createField = (label: string, helpText: string, element: HTMLElement) => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '6px';
      wrapper.style.marginBottom = '14px';

      const lblContainer = document.createElement('div');
      lblContainer.style.display = 'flex';
      lblContainer.style.alignItems = 'center';
      lblContainer.style.gap = '4px';

      const lbl = document.createElement('label');
      lbl.textContent = label;
      lbl.style.fontSize = '12px';
      lbl.style.fontWeight = '500';
      lbl.style.color = 'var(--color-on-surface-variant)';

      lblContainer.appendChild(lbl);

      if (helpText) {
        const helpIcon = icon('help', 14);
        helpIcon.style.color = 'var(--color-on-surface-variant)';
        helpIcon.style.cursor = 'help';
        helpIcon.title = helpText;
        lblContainer.appendChild(helpIcon);
      }

      wrapper.appendChild(lblContainer);
      wrapper.appendChild(element);
      return wrapper;
    };

    // --- 1. Info Card: Target Image status ---
    const infoCard = document.createElement('div');
    infoCard.style.padding = '10px 12px';
    infoCard.style.backgroundColor = 'var(--color-surface-container, rgba(255, 255, 255, 0.04))';
    infoCard.style.border = '1px solid var(--color-outline-variant, rgba(255, 255, 255, 0.1))';
    infoCard.style.borderRadius = '6px';
    infoCard.style.marginBottom = '16px';
    infoCard.style.fontSize = '12px';
    infoCard.style.lineHeight = '1.5';

    const docManager = DocumentManager.getInstance();
    const currentCanvas = docManager.getCurrentCanvas();
    const currentFilename = docManager.getCurrentFilename();

    const currentFolder = docManager.getCurrentArchiveFolder();

    if (currentCanvas) {
      infoCard.innerHTML = `
        <div style="font-weight: 600; color: var(--color-on-surface); margin-bottom: 2px;">
          対象画像: ${currentFilename || 'キャンバス画像'}
        </div>
        <div style="color: var(--color-primary); font-size: 11px; margin-bottom: 2px; display: flex; align-items: center; gap: 4px;">
          <span class="material-symbols-outlined" style="font-size: 13px;">folder</span>
          保存先: ${currentFolder ? `${currentFolder} / [日時]_コマ分割/ (サブフォルダ)` : '[日時]_コマ分割/ (新規フォルダ作成)'}
        </div>
        <div style="color: var(--color-on-surface-variant); font-size: 11px;">
          解像度: ${currentCanvas.width} × ${currentCanvas.height} px
        </div>
      `;
    } else {
      infoCard.innerHTML = `
        <div style="color: var(--color-warning, #e6a23c); font-weight: 500;">
          ⚠️ 分割対象の画像が選択されていません
        </div>
        <div style="color: var(--color-on-surface-variant); font-size: 11px; margin-top: 2px;">
          左側のARCHIVESから分割したい画像を選択してください。
        </div>
      `;
    }
    container.appendChild(infoCard);

    // --- 2. Model Select ---
    const modelSelect = document.createElement('select');
    modelSelect.style.width = '100%';
    modelSelect.style.padding = '8px 10px';
    modelSelect.style.backgroundColor = 'var(--color-surface-container-high, #2b2b2b)';
    modelSelect.style.color = 'var(--color-on-surface, #fff)';
    modelSelect.style.border = '1px solid var(--color-outline, rgba(255, 255, 255, 0.2))';
    modelSelect.style.borderRadius = '4px';
    modelSelect.style.fontSize = '12px';
    modelSelect.style.outline = 'none';

    const modelOptions = [
      { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    ];

    modelOptions.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      modelSelect.appendChild(option);
    });

    const defaultModel = 'gemini-3.8-flash';
    let savedModel = this.getSetting('model', defaultModel);
    if (savedModel === 'gemini-3.1-pro') {
      savedModel = 'gemini-3.1-pro-preview';
      this.setSetting('model', savedModel);
    }
    modelSelect.value = savedModel;

    modelSelect.addEventListener('change', () => {
      this.setSetting('model', modelSelect.value);
    });

    // --- 3. Thinking Level Select (thinkingConfig) ---
    const thinkingSelect = document.createElement('select');
    thinkingSelect.style.width = '100%';
    thinkingSelect.style.padding = '8px 10px';
    thinkingSelect.style.backgroundColor = 'var(--color-surface-container-high, #2b2b2b)';
    thinkingSelect.style.color = 'var(--color-on-surface, #fff)';
    thinkingSelect.style.border = '1px solid var(--color-outline, rgba(255, 255, 255, 0.2))';
    thinkingSelect.style.borderRadius = '4px';
    thinkingSelect.style.fontSize = '12px';
    thinkingSelect.style.outline = 'none';

    const thinkingOptions = [
      { value: 'LOW', label: 'LOW' },
      { value: 'MEDIUM', label: 'MEDIUM' },
      { value: 'HIGH', label: 'HIGH' },
    ];

    thinkingOptions.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      thinkingSelect.appendChild(option);
    });

    const defaultThinking = 'LOW';
    thinkingSelect.value = this.getSetting('thinking_level', defaultThinking);

    thinkingSelect.addEventListener('change', () => {
      this.setSetting('thinking_level', thinkingSelect.value);
    });

    // --- 4. Reading Order Select ---
    const orderSelect = document.createElement('select');
    orderSelect.style.width = '100%';
    orderSelect.style.padding = '8px 10px';
    orderSelect.style.backgroundColor = 'var(--color-surface-container-high, #2b2b2b)';
    orderSelect.style.color = 'var(--color-on-surface, #fff)';
    orderSelect.style.border = '1px solid var(--color-outline, rgba(255, 255, 255, 0.2))';
    orderSelect.style.borderRadius = '4px';
    orderSelect.style.fontSize = '12px';
    orderSelect.style.outline = 'none';

    const optLeftToRight = document.createElement('option');
    optLeftToRight.value = 'left_to_right';
    optLeftToRight.textContent = '左上から右下（ウェブトゥーン・左開き）';

    const optRightToLeft = document.createElement('option');
    optRightToLeft.value = 'right_to_left';
    optRightToLeft.textContent = '右上から左下（日本の漫画・右開き標準）';

    orderSelect.appendChild(optLeftToRight);
    orderSelect.appendChild(optRightToLeft);
    orderSelect.value = this.getSetting('reading_order', 'left_to_right');

    orderSelect.addEventListener('change', () => {
      this.setSetting('reading_order', orderSelect.value);
    });

    // --- 5. Padding Slider ---
    const paddingWrapper = document.createElement('div');
    paddingWrapper.style.display = 'flex';
    paddingWrapper.style.alignItems = 'center';
    paddingWrapper.style.gap = '8px';

    const paddingSlider = document.createElement('input');
    paddingSlider.type = 'range';
    paddingSlider.min = '0';
    paddingSlider.max = '30';
    paddingSlider.step = '1';
    paddingSlider.value = this.getSetting('padding', '0');
    paddingSlider.style.flex = '1';

    const paddingValueDisplay = document.createElement('span');
    paddingValueDisplay.textContent = `${paddingSlider.value}px`;
    paddingValueDisplay.style.fontSize = '12px';
    paddingValueDisplay.style.width = '36px';
    paddingValueDisplay.style.textAlign = 'right';
    paddingValueDisplay.style.color = 'var(--color-on-surface)';

    paddingSlider.addEventListener('input', () => {
      paddingValueDisplay.textContent = `${paddingSlider.value}px`;
      this.setSetting('padding', paddingSlider.value);
    });

    paddingWrapper.appendChild(paddingSlider);
    paddingWrapper.appendChild(paddingValueDisplay);

    // Mount fields into container
    container.appendChild(createField(
      'モデル (Model)',
      'コマ枠認識に使用するGeminiモデルを選択します。',
      modelSelect
    ));

    container.appendChild(createField(
      '推論レベル (thinkingLevel)',
      'Gemini 3系モデルの思考深度（thinkingConfig）を設定します。',
      thinkingSelect
    ));

    container.appendChild(createField(
      'コマの読み順（連番の並び順）',
      '連番ファイル名（01.png, 02.png...）を付与する際のコマの順序を指定します。',
      orderSelect
    ));

    container.appendChild(createField(
      'コマ余白（パディング）',
      '検出されたコマ枠線の外側に余白（ピクセル）を追加して切り抜きます。',
      paddingWrapper
    ));

    // --- 6. JSON Preview Button ---
    const previewBtn = document.createElement('button');
    previewBtn.textContent = 'JSONプレビュー';
    previewBtn.style.padding = '8px';
    previewBtn.style.borderRadius = '4px';
    previewBtn.style.background = 'var(--color-surface-container-high)';
    previewBtn.style.color = 'var(--color-on-surface)';
    previewBtn.style.border = '1px solid var(--color-outline-variant)';
    previewBtn.style.cursor = 'pointer';
    previewBtn.style.marginTop = '12px';
    previewBtn.style.width = '100%';
    previewBtn.style.fontSize = '12px';

    previewBtn.addEventListener('click', () => {
      let currentModel = this.getSetting('model', 'gemini-3.8-flash');
      if (currentModel === 'gemini-3.1-pro') {
        currentModel = 'gemini-3.1-pro-preview';
      }
      const currentThinking = this.getSetting('thinking_level', 'LOW');
      const currentOrder = this.getSetting('reading_order', 'left_to_right');
      const currentPadding = parseInt(this.getSetting('padding', '0'), 10) || 0;
      const currentFilename = docManager.getCurrentFilename() || 'image.png';
      const currentFolder = docManager.getCurrentArchiveFolder();

      const readingOrderDesc = currentOrder === 'left_to_right'
        ? 'Western comic reading order (top-to-bottom, left-to-right)'
        : 'Japanese manga reading order (top-to-bottom, right-to-left)';

      const promptText = `You are an expert manga / comic panel detector.
Analyze this image and accurately detect all individual comic panels (frames / コマ).
Return the bounding box coordinates for each panel.
Order the panels strictly in ${readingOrderDesc}.

Output a JSON array of objects with the following schema:
[
  {
    "panel_number": 1,
    "box_2d": [ymin, xmin, ymax, xmax]
  }
]

Important constraints:
- Coordinates [ymin, xmin, ymax, xmax] MUST be normalized integers from 0 to 1000 relative to the image height and width.
  ymin=0 is top, ymax=1000 is bottom. xmin=0 is left, xmax=1000 is right.
- Ensure the bounding boxes tightly encompass each panel's outer borders/content without cutting off dialogue bubbles or artwork.
- Return ONLY valid JSON, with no markdown fences, no conversational text.`;

      const previewData = {
        api_endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent`,
        request_body: {
          contents: [
            {
              parts: [
                {
                  text: promptText
                },
                {
                  inline_data: {
                    mime_type: "image/png",
                    data: "<BASE64_IMAGE_DATA>"
                  }
                }
              ]
            }
          ],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.1,
            thinkingConfig: {
              thinkingLevel: currentThinking
            },
            response_schema: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  panel_number: { type: "INTEGER" },
                  box_2d: {
                    type: "ARRAY",
                    items: { type: "INTEGER" }
                  }
                },
                required: ["panel_number", "box_2d"]
              }
            }
          }
        },
        output_format: {
          save_destination: currentFolder
            ? `${currentFolder}/YYYYMMDD_HHMMSS_コマ分割/ (選択中フォルダ内のサブフォルダ)`
            : 'YYYYMMDD_HHMMSS_コマ分割/ (新規フォルダ作成)',
          archive_path: currentFolder ? `${currentFolder}/YYYYMMDD_HHMMSS_コマ分割` : 'YYYYMMDD_HHMMSS_コマ分割',
          generated_files: [
            currentFolder ? "YYYYMMDD_HHMMSS_コマ分割/01.png, 02.png, ... (切り分けられた各コマの個別PNG画像)" : "01.png, 02.png, ... (個別PNG画像)",
            currentFolder ? "YYYYMMDD_HHMMSS_コマ分割/panels.json (構造化JSONデータ)" : "panels.json (構造化JSONデータ)",
            currentFolder ? "log.txt (元フォルダのlog.txtに一文追記)" : "log.txt (実行ログ一文)"
          ],
          panels_json_sample: {
            version: "1.0",
            created_at: new Date().toISOString().replace('T', ' ').substring(0, 19),
            original_filename: currentFilename,
            image_size: {
              width: currentCanvas ? currentCanvas.width : 1200,
              height: currentCanvas ? currentCanvas.height : 1800
            },
            reading_order: currentOrder,
            model: currentModel,
            thinking_level: currentThinking,
            padding: currentPadding,
            panels_count: 4,
            panels: [
              {
                panel_number: 1,
                filename: "01.png",
                pixel_box: [0, 0, 500, 600],
                xywh: [0, 0, 500, 600],
                box_2d: [0, 0, 500, 500],
                width: 500,
                height: 600
              }
            ]
          }
        }
      };

      const dialog = document.createElement('dialog');
      dialog.style.width = '80vw';
      dialog.style.maxWidth = '720px';
      dialog.style.height = '80vh';
      dialog.style.backgroundColor = 'var(--color-surface-container-high, #201e22)';
      dialog.style.color = 'var(--color-on-surface, #fff)';
      dialog.style.border = '1px solid var(--color-outline, rgba(255, 255, 255, 0.2))';
      dialog.style.borderRadius = '8px';
      dialog.style.padding = '16px';
      dialog.style.display = 'flex';
      dialog.style.flexDirection = 'column';
      dialog.style.zIndex = '10000';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.marginBottom = '16px';

      const title = document.createElement('h3');
      title.textContent = 'JSON Preview';
      title.style.margin = '0';
      title.style.fontSize = '14px';

      const headerBtnRow = document.createElement('div');
      headerBtnRow.style.display = 'flex';
      headerBtnRow.style.gap = '8px';

      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'コピー';
      copyBtn.style.padding = '4px 12px';
      copyBtn.style.cursor = 'pointer';
      copyBtn.style.background = 'var(--color-surface-container-highest, #333)';
      copyBtn.style.color = 'var(--color-on-surface, #fff)';
      copyBtn.style.border = '1px solid var(--color-outline-variant, rgba(255, 255, 255, 0.1))';
      copyBtn.style.borderRadius = '4px';
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(JSON.stringify(previewData, null, 2));
        showToast('JSONをクリップボードにコピーしました');
      };

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '閉じる';
      closeBtn.style.padding = '4px 12px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.background = 'var(--color-surface-container-highest, #333)';
      closeBtn.style.color = 'var(--color-on-surface, #fff)';
      closeBtn.style.border = '1px solid var(--color-outline-variant, rgba(255, 255, 255, 0.1))';
      closeBtn.style.borderRadius = '4px';
      closeBtn.onclick = () => dialog.close();

      headerBtnRow.appendChild(copyBtn);
      headerBtnRow.appendChild(closeBtn);

      header.appendChild(title);
      header.appendChild(headerBtnRow);

      const pre = document.createElement('pre');
      pre.style.flex = '1';
      pre.style.overflow = 'auto';
      pre.style.margin = '0';
      pre.style.padding = '12px';
      pre.style.backgroundColor = 'var(--color-surface-container-lowest, #111)';
      pre.style.borderRadius = '4px';
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordWrap = 'break-word';
      pre.style.fontFamily = 'monospace';
      pre.style.fontSize = '12px';
      pre.textContent = JSON.stringify(previewData, null, 2);

      dialog.appendChild(header);
      dialog.appendChild(pre);

      dialog.addEventListener('close', () => dialog.remove());
      document.body.appendChild(dialog);
      dialog.showModal();
    });

    container.appendChild(previewBtn);
  }

  async execute(context: ToolContext): Promise<void> {
    const docManager = DocumentManager.getInstance();

    // 1. Get current selected image canvas
    let targetCanvas = await context.getSelectedImage();
    if (!targetCanvas) {
      targetCanvas = await context.getCompositeImage();
    }

    if (!targetCanvas) {
      throw new Error('ARCHIVESで分割対象の画像を選択してください。');
    }

    // 2. Convert Canvas to PNG Blob
    const imageBlob = await new Promise<Blob | null>(resolve => {
      targetCanvas!.toBlob(resolve, 'image/png');
    });

    if (!imageBlob) {
      throw new Error('画像のBlobデータ変換に失敗しました。');
    }

    const originalFilename = docManager.getCurrentFilename() || 'image.png';
    const readingOrder = this.getSetting('reading_order', 'left_to_right');
    const padding = parseInt(this.getSetting('padding', '0'), 10) || 0;
    let model = this.getSetting('model', 'gemini-3.8-flash');
    if (model === 'gemini-3.1-pro') {
      model = 'gemini-3.1-pro-preview';
    }
    const thinkingLevel = this.getSetting('thinking_level', 'LOW');
    const currentFolder = docManager.getCurrentArchiveFolder();

    // 3. Send request to backend API
    const formData = new FormData();
    formData.append('image', imageBlob, originalFilename);
    formData.append('reading_order', readingOrder);
    formData.append('padding', padding.toString());
    formData.append('original_filename', originalFilename);
    formData.append('model_name', model);
    formData.append('thinking_level', thinkingLevel);
    if (currentFolder) {
      formData.append('target_folder', currentFolder);
    }

    const response = await fetch('http://127.0.0.1:48000/api/image/split-panels', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorJson = await response.json();
        errorDetail = errorJson.detail || JSON.stringify(errorJson);
      } catch {
        errorDetail = await response.text();
      }
      throw new Error(`コマ分割処理に失敗しました: ${errorDetail}`);
    }

    const result = await response.json();

    // 4. Update ARCHIVES & auto-select the first panel
    const autoSelectKey = result.auto_select_key || `${result.folder_name}/01.png`;
    const destinationDesc = result.sub_folder
      ? `「${result.archive_name}/${result.sub_folder}」`
      : `「${result.archive_name}」`;

    // Track active folder
    if (result.sub_folder) {
      docManager.setCurrentArchiveFolder(`${result.archive_name}/${result.sub_folder}`);
    } else {
      docManager.setCurrentArchiveFolder(result.archive_name);
    }

    // Notify ARCHIVES panel to refresh and auto-select 01.png
    window.dispatchEvent(new CustomEvent('tool:cache-updated', { detail: { autoSelectKey } }));

    showToast(`${destinationDesc} に ${result.panels_count} コマを分割保存しました（panels.json 出力完了）`, 'success');
  }
}
