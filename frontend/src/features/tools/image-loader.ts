/**
 * 画像読み込み — imports an image file as a new archive "<YYYYMMDD_HHMMSS>_<name>" (a "_2" ...
 * suffix when taken) containing only the file, then selects it.
 * The file is chosen in the OS file dialog, which the backend opens in the folder set in the tool
 * window (the browser's picker cannot start in a given folder). Canvas drag & drop runs the same
 * import (`importImageTool`). Spec: docs/specs/tools/image-loader.md
 */
import { saveResult } from '../../shared/api/archives';
import { ApiError } from '../../shared/api/http';
import { checkFolder, pickImageFile } from '../../shared/api/local-files';
import { emit } from '../../shared/events';
import { toolSettings } from '../../shared/state/tool-settings';
import { type Tool, ToolCancelled, type ToolContext, ToolNotReady } from '../../shared/types/tool';
import { h } from '../../shared/ui/dom';
import { field } from '../../shared/ui/form';
import { fileStamp } from '../../shared/utils/datetime';
import { discardIfStopped } from './result';

const NAME = '画像読み込み';

const FOLDER_HELP = [
  'ファイル選択のダイアログを最初に開くフォルダ（絶対パス。例: D:\\manga\\raw）。',
  '空欄ならこのアプリのフォルダ（プロジェクトのフォルダ）で開きます。',
  'ダイアログはバックエンドを動かしている PC に開きます。',
].join('\n');

/** Creates the archive for `file` and selects the image. Returns the result summary. */
async function importImageFile(file: File, signal: AbortSignal): Promise<string> {
  const baseName = (file.name.replace(/\.[^/.]+$/, '') || file.name).replace(/[\\/:*?"<>|]/g, '_');
  // The archive is the page itself: no info.json (the original file name stays as the image name).
  const archive = await saveResult({
    root: null,
    name: `${fileStamp()}_${baseName}`,
    info: null,
    files: [{ blob: file, path: file.name }],
  });
  await discardIfStopped(signal, archive);

  emit('archives:changed', { autoSelectKey: `${archive}/${file.name}` });
  return `「${archive}」を作成し、${file.name} を読み込みました`;
}

/** The 画像読み込み tool for a file that is already chosen (canvas drag & drop). */
export function importImageTool(file: File): Pick<Tool, 'name' | 'execute'> {
  return { name: NAME, execute: context => importImageFile(file, context.signal) };
}

export class ImageLoaderTool implements Tool {
  id = 'image-loader';
  name = NAME;
  icon = '';
  executeIcon = 'folder_open';

  settingsPrefix = 'imageLoader';
  private settings = toolSettings(this.settingsPrefix);

  renderSettings(container: HTMLElement): void {
    const input = h('input', {
      class: 'cs-input',
      type: 'text',
      placeholder: '未指定（このアプリのフォルダ）',
      value: this.settings.get('initialDir', ''),
    });
    input.addEventListener('input', () => this.settings.set('initialDir', input.value));
    container.append(field('最初に開くフォルダ', input, FOLDER_HELP));
  }

  async execute(context: ToolContext): Promise<string> {
    const folder = this.settings.get('initialDir', '');
    try {
      await checkFolder(folder);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw new ToolNotReady(err.message);
      throw err;
    }
    context.ready();
    const file = await pickImageFile(folder, context.signal);
    if (!file) throw new ToolCancelled();
    return importImageFile(file, context.signal);
  }
}
