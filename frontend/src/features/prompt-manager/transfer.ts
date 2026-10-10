/** Export / import of the registered prompts (docs/specs/prompt-manager.md 「エクスポート / インポート」). */
import { type ImportConflictPolicy, importPrompts, listPrompts } from '../../shared/api/prompts';
import { choiceDialog } from '../../shared/ui/dialogs';
import { h } from '../../shared/ui/dom';
import { showError, showToast } from '../../shared/ui/toast';
import { fileStamp } from '../../shared/utils/datetime';
import { downloadBlob } from '../../shared/utils/download';
import { countImportConflicts, exportData, parseImportFile } from '../../shared/utils/prompts';

function showWarnings(warnings: string[]): void {
  for (const warning of warnings) showToast(warning, 'warning');
}

/** Saves every prompt as a JSON file through the browser's download. */
export async function exportPrompts(): Promise<void> {
  try {
    const { warnings, ...store } = await listPrompts();
    showWarnings(warnings);
    const blob = new Blob([`${JSON.stringify(exportData(store), null, 2)}\n`], { type: 'application/json' });
    const name = `confeito-prompts-${fileStamp()}.json`;
    downloadBlob(blob, name);
    showToast(`プロンプト ${store.prompts.length} 件を ${name} に書き出しました`, 'success');
  } catch (err) {
    showError('プロンプトを書き出せませんでした', err);
  }
}

/** Asks for a JSON file and adds its prompts; resolves true when the list changed. */
export function chooseImportFile(): Promise<boolean> {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void importFile(file).then(resolve);
      else resolve(false);
    });
    input.click();
  });
}

async function importFile(file: File): Promise<boolean> {
  try {
    const { prompts: items, categories } = parseImportFile(await file.text());
    const { warnings, prompts } = await listPrompts();
    showWarnings(warnings);
    let policy: ImportConflictPolicy = 'skip';
    const conflicts = countImportConflicts(prompts, items);
    if (conflicts > 0) {
      const choice = await choiceDialog<ImportConflictPolicy>({
        title: 'プロンプトのインポート',
        message: `${conflicts} 件の名前がすでに登録されています。`,
        choices: [
          { value: 'overwrite', label: '上書き' },
          { value: 'rename', label: '名前を変えて追加' },
          { value: 'skip', label: 'スキップ', variant: 'primary' },
        ],
      });
      if (!choice) return false;
      policy = choice;
    }
    const result = await importPrompts(items, categories, policy);
    showWarnings(result.warnings);
    if (result.invalid > 0) {
      showToast(`名前・本文が正しくない ${result.invalid} 件は読み込みませんでした。`, 'warning');
    }
    showToast(
      `プロンプトを読み込みました（追加 ${result.added} 件・上書き ${result.overwritten} 件・スキップ ${result.skipped} 件）`,
      'success',
    );
    return result.added + result.overwritten > 0;
  } catch (err) {
    showError(`「${file.name}」をインポートできませんでした`, err);
    return false;
  }
}
