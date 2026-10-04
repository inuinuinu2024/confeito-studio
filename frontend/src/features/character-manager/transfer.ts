/** Export / import of the registered characters as a zip (docs/specs/character-manager.md 「エクスポート / インポート」). */
import {
  exportCharacters,
  type ImportConflictPolicy,
  importCharacters,
  listCharacters,
  previewCharacterImport,
} from '../../shared/api/characters';
import { choiceDialog } from '../../shared/ui/dialogs';
import { h } from '../../shared/ui/dom';
import { showError, showToast } from '../../shared/ui/toast';
import { fileStamp } from '../../shared/utils/datetime';

function showWarnings(warnings: string[]): void {
  for (const warning of warnings) showToast(warning, 'warning');
}

/** Saves every character (with the images) as a zip through the browser's download. */
export async function exportAll(): Promise<void> {
  try {
    const { warnings, characters } = await listCharacters();
    showWarnings(warnings);
    const url = URL.createObjectURL(await exportCharacters());
    const name = `confeito-characters-${fileStamp()}.zip`;
    h('a', { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`キャラクター ${characters.length} 件を ${name} に書き出しました`, 'success');
  } catch (err) {
    showError('キャラクターを書き出せませんでした', err);
  }
}

/** Asks for a zip and adds its characters; resolves true when the list changed. */
export function chooseImportFile(): Promise<boolean> {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept: '.zip,application/zip' });
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
    const preview = await previewCharacterImport(file);
    showWarnings(preview.warnings);
    let policy: ImportConflictPolicy = 'skip';
    if (preview.conflicts > 0) {
      const choice = await choiceDialog<ImportConflictPolicy>({
        title: 'キャラクターのインポート',
        message: `${preview.conflicts} 件の名前がすでに登録されています。`,
        choices: [
          { value: 'overwrite', label: '上書き' },
          { value: 'rename', label: '名前を変えて追加' },
          { value: 'skip', label: 'スキップ', variant: 'primary' },
        ],
      });
      if (!choice) return false;
      policy = choice;
    }
    const result = await importCharacters(file, policy);
    showWarnings(result.warnings);
    if (result.invalid > 0) showToast(`名前が正しくない ${result.invalid} 件は読み込みませんでした。`, 'warning');
    if (result.skipped_images > 0) {
      showToast(`読み込めなかった画像 ${result.skipped_images} 枚は外しました。`, 'warning');
    }
    showToast(
      `キャラクターを読み込みました（追加 ${result.added} 件・上書き ${result.overwritten} 件・スキップ ${result.skipped} 件）`,
      'success',
    );
    return result.added + result.overwritten > 0;
  } catch (err) {
    showError(`「${file.name}」をインポートできませんでした`, err);
    return false;
  }
}
