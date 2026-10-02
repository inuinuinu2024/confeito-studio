/**
 * 画像読み込み — imports an image file as a new archive "<YYYYMMDD_HHMMSS>_<name>" containing
 * the file and log.txt, then selects it. Also used for drag & drop onto the canvas.
 */
import { saveArchive } from '../../shared/api/archives';
import { IMAGE_ACCEPT, IMAGE_EXTENSIONS } from '../../shared/config';
import { emit } from '../../shared/events';
import { type Tool, ToolCancelled } from '../../shared/types/tool';
import { showToast } from '../../shared/ui/toast';
import { fileStamp, logStamp } from '../../shared/utils/datetime';
import { DocumentManager } from '../document/DocumentManager';

/** Creates the archive for `file` and selects the image. Returns the archive name. */
export async function importImageFile(file: File): Promise<string> {
  const now = new Date();
  const baseName = (file.name.replace(/\.[^/.]+$/, '') || file.name).replace(/[\\/:*?"<>|]/g, '_');
  const folderName = `${fileStamp(now)}_${baseName}`;
  const log = `[${logStamp(now)}] 画像読み込みツールにより読み込まれました (ファイル名: ${file.name})\n`;

  await saveArchive(folderName, [
    { blob: file, path: file.name },
    { blob: new Blob([log], { type: 'text/plain; charset=utf-8' }), path: 'log.txt' },
  ]);

  DocumentManager.getInstance().setCurrentArchiveFolder(folderName);
  emit('archives:changed', { autoSelectKey: `${folderName}/${file.name}` });
  showToast(`アーカイブ「${folderName}」を作成し、画像を読み込みました`, 'success');
  return folderName;
}

/** Native file picker when available, otherwise a hidden <input type=file>. Null if cancelled. */
async function pickImageFile(): Promise<File | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [{ description: 'Image Files', accept: { 'image/*': IMAGE_EXTENSIONS } }],
      });
      return await handle.getFile();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null;
      console.warn('showOpenFilePicker failed, falling back to input:', err);
    }
  }
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_ACCEPT;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      input.remove();
      resolve(input.files?.[0] ?? null);
    };
    input.click();
  });
}

export class ImageLoaderTool implements Tool {
  id = 'image-loader';
  name = '画像読み込み';
  icon = '';

  async execute(): Promise<void> {
    const file = await pickImageFile();
    if (!file) throw new ToolCancelled();
    await importImageFile(file);
  }
}
