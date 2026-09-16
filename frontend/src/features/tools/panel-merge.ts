import { Tool, ToolContext } from '../../shared/types/tool.types';
import { DocumentManager } from '../document/DocumentManager';
import { showToast } from '../../shared/utils/toast';

export class PanelMergeTool implements Tool {
  id = 'panel-merge';
  name = 'コマ結合';
  hasSettings = false;

  async execute(context: ToolContext): Promise<void> {
    const docManager = DocumentManager.getInstance();
    const currentFolder = docManager.getCurrentArchiveFolder();

    if (!currentFolder) {
      throw new Error('ARCHIVESリストから結合したい「コマ分割」フォルダ（panels.json が含まれるフォルダ）を選択してください。');
    }

    const formData = new FormData();
    formData.append('target_folder', currentFolder);

    const response = await fetch('http://127.0.0.1:48000/api/image/merge-panels', {
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
      throw new Error(`コマ結合処理に失敗しました: ${errorDetail}`);
    }

    const result = await response.json();

    // Notify ARCHIVES panel to refresh and auto-select the merged image
    const autoSelectKey = result.auto_select_key;
    if (result.parent_folder) {
      docManager.setCurrentArchiveFolder(result.parent_folder);
    }
    window.dispatchEvent(new CustomEvent('tool:cache-updated', { detail: { autoSelectKey } }));

    showToast(`コマを結合し、${result.filename} として保存しました`, 'success');
  }
}
