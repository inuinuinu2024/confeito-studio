import { Tool, ToolContext } from '../../shared/types/tool.types';
import { saveArchive } from '../../shared/utils/archives';
import { DocumentManager } from '../document/DocumentManager';
import { showToast } from '../../shared/utils/toast';

export async function importImageFile(file: File): Promise<string> {
  const docManager = DocumentManager.getInstance();

  // 1. Generate folder name: YYYYMMDD_HHMMSS_画像名
  const now = new Date();
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const SS = String(now.getSeconds()).padStart(2, '0');
  const timeStamp = `${YYYY}${MM}${DD}_${HH}${mm}${SS}`;

  const rawBaseName = file.name.replace(/\.[^/.]+$/, '') || file.name;
  const cleanImageName = rawBaseName.replace(/[\\/:\*\?"<>\|]/g, '_');
  const folderName = `${timeStamp}_${cleanImageName}`;

  // 2. Create initial log.txt
  const formattedDate = `${YYYY}-${MM}-${DD} ${HH}:${mm}:${SS}`;
  const initialLog = `[${formattedDate}] 画像読み込みツールにより読み込まれました (ファイル名: ${file.name})\n`;
  const logBlob = new Blob([initialLog], { type: 'text/plain; charset=utf-8' });

  // 3. Save to ARCHIVES
  const archiveFiles: { blob: Blob; path: string }[] = [
    { blob: file, path: file.name },
    { blob: logBlob, path: 'log.txt' },
  ];

  await saveArchive(folderName, archiveFiles);

  // 4. Track current archive folder in DocumentManager & auto-select the image in ARCHIVES
  docManager.setCurrentArchiveFolder(folderName);
  const autoSelectKey = `${folderName}/${file.name}`;
  window.dispatchEvent(new CustomEvent('tool:cache-updated', { detail: { autoSelectKey } }));
  showToast(`アーカイブ「${folderName}」を作成し、画像を読み込みました`, 'success');

  return folderName;
}

export class ImageLoaderTool implements Tool {
  id = 'image-loader';
  name = '画像読み込み';
  icon = '';
  hasSettings = false;

  async execute(context: ToolContext): Promise<void> {
    let file: File | null = null;

    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await (window as any).showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'Image Files',
              accept: {
                'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'],
              },
            },
          ],
        });
        file = await fileHandle.getFile();
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // User canceled file picker
          const abortErr = new Error('AbortError');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        console.warn('showOpenFilePicker failed, falling back to input:', err);
      }
    }

    if (!file) {
      file = await new Promise<File | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png, image/jpeg, image/webp, image/bmp, image/gif';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.onchange = () => {
          const selected = input.files && input.files[0] ? input.files[0] : null;
          if (document.body.contains(input)) {
            document.body.removeChild(input);
          }
          resolve(selected);
        };

        input.click();
      });
    }

    if (!file) {
      const abortErr = new Error('AbortError');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    await importImageFile(file);
  }
}
