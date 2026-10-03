/**
 * コマ結合 — pastes the panels of the selected コマ分割 folder back into one image, saved by the
 * backend as a tool result "<archive>/<stamp>_コマ結合/" (services/merge_service.py).
 * The tool window shows the target folder, what its panels.json says and where the result goes.
 * Spec: docs/specs/tools/panel-split-merge.md
 */
import { fetchArchiveKey } from '../../shared/api/archives';
import { mergePanels } from '../../shared/api/image';
import { emit } from '../../shared/events';
import { type Tool, ToolNotReady } from '../../shared/types/tool';
import { h } from '../../shared/ui/dom';
import { DocumentManager } from '../document/DocumentManager';
import { missingTargetCard, saveDestinationLine } from './target-card';

const SELECT_FOLDER = 'ARCHIVES でコマ分割のフォルダ（panels.json を含むフォルダ）を選択してください。';

/** One line about the folder's panels.json, or a warning when it is missing or broken. */
async function describePanels(folder: string): Promise<{ text: string; ok: boolean }> {
  const blob = await fetchArchiveKey(`${folder}/panels.json`);
  if (!blob) return { text: `⚠️ このフォルダに panels.json がありません。${SELECT_FOLDER}`, ok: false };
  try {
    const data = JSON.parse(await blob.text()) as {
      panels?: unknown[];
      image_size?: { width?: number; height?: number };
    };
    const size = data.image_size ? `${data.image_size.width} × ${data.image_size.height} px` : '不明';
    return { text: `コマ数: ${data.panels?.length ?? 0} / 結合後の大きさ: ${size}`, ok: true };
  } catch {
    return { text: '⚠️ panels.json を読み取れませんでした（ファイルが壊れている可能性があります）。', ok: false };
  }
}

export class PanelMergeTool implements Tool {
  id = 'panel-merge';
  name = 'コマ結合';
  executeIcon = null;

  renderSettings(container: HTMLElement): void {
    container.append(this.targetCard());
  }

  /** The selected folder, its panels.json and where the merged image is saved. */
  private targetCard(): HTMLElement {
    const folder = DocumentManager.getInstance().getCurrentArchiveFolder();
    if (!folder) return missingTargetCard('結合するフォルダ', SELECT_FOLDER);
    const panels = h('div', { class: 'cs-card__line', text: 'panels.json を確認しています…' });
    void describePanels(folder).then(({ text, ok }) => {
      panels.textContent = text;
      if (!ok) panels.className = 'cs-card__warning';
    });
    return h(
      'div',
      { class: 'cs-card' },
      h('div', { class: 'cs-card__title', text: `対象フォルダ: ${folder}` }),
      saveDestinationLine(this.name),
      panels,
    );
  }

  async execute(): Promise<string> {
    const folder = DocumentManager.getInstance().getCurrentArchiveFolder();
    if (!folder) throw new ToolNotReady(SELECT_FOLDER);

    const result = await mergePanels(folder);
    emit('archives:changed', { autoSelectKey: result.auto_select_key });
    return `「${result.folder}」に結合画像を保存しました`;
  }
}
