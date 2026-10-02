/**
 * コマ結合 — pastes the panels of the selected コマ分割 folder back into one image
 * (backend: services/merge_service.py). Spec: docs/specs/tools/panel-split-merge.md
 */
import { ApiError } from '../../shared/api/http';
import { mergePanels } from '../../shared/api/image';
import { emit } from '../../shared/events';
import type { Tool } from '../../shared/types/tool';
import { showToast } from '../../shared/ui/toast';
import { DocumentManager } from '../document/DocumentManager';

export class PanelMergeTool implements Tool {
  id = 'panel-merge';
  name = 'コマ結合';

  async execute(): Promise<void> {
    const docManager = DocumentManager.getInstance();
    const folder = docManager.getCurrentArchiveFolder();
    if (!folder) {
      throw new Error(
        'ARCHIVESリストから結合したい「コマ分割」フォルダ（panels.json が含まれるフォルダ）を選択してください。',
      );
    }

    let result;
    try {
      result = await mergePanels(folder);
    } catch (err) {
      if (err instanceof ApiError) throw new Error(`コマ結合処理に失敗しました: ${err.message}`);
      throw err;
    }

    if (result.parent_folder) docManager.setCurrentArchiveFolder(result.parent_folder);
    emit('archives:changed', { autoSelectKey: result.auto_select_key });
    showToast(`コマを結合し、${result.filename} として保存しました`, 'success');
  }
}
