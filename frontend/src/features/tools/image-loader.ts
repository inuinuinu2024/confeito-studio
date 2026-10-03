/**
 * 画像読み込み — imports an image file as a new archive "<YYYYMMDD_HHMMSS>_<name>" (a "_2" ...
 * suffix when taken) containing only the file, then selects it. Canvas drag & drop runs the
 * same tool (`importImageTool`).
 */
import { saveResult } from '../../shared/api/archives';
import { IMAGE_ACCEPT, IMAGE_EXTENSIONS } from '../../shared/config';
import { emit } from '../../shared/events';
import { type Tool, ToolCancelled } from '../../shared/types/tool';
import { fileStamp } from '../../shared/utils/datetime';

const NAME = '画像読み込み';

/** Creates the archive for `file` and selects the image. Returns the result summary. */
async function importImageFile(file: File): Promise<string> {
  const baseName = (file.name.replace(/\.[^/.]+$/, '') || file.name).replace(/[\\/:*?"<>|]/g, '_');
  // The archive is the page itself: no info.json (the original file name stays as the image name).
  const archive = await saveResult({
    root: null,
    name: `${fileStamp()}_${baseName}`,
    info: null,
    files: [{ blob: file, path: file.name }],
  });

  emit('archives:changed', { autoSelectKey: `${archive}/${file.name}` });
  return `「${archive}」を作成し、${file.name} を読み込みました`;
}

/** The 画像読み込み tool for a file that is already chosen (canvas drag & drop). */
export function importImageTool(file: File): Pick<Tool, 'name' | 'execute'> {
  return { name: NAME, execute: () => importImageFile(file) };
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
  name = NAME;
  icon = '';

  async execute(): Promise<string> {
    const file = await pickImageFile();
    if (!file) throw new ToolCancelled();
    return importImageFile(file);
  }
}
