/**
 * Saving images of the Workspace as files to use outside the app (docs/specs/flow-canvas.md 「画像の書き出し」):
 * one image is downloaded as it is, several side by side in one zip. File names: shared/utils/archives.ts imageFileName.
 */
import { exportImages, extractArchiveFile, splitArchiveKey } from '../../shared/api/archives';
import { showError, showToast } from '../../shared/ui/toast';
import { imageFileName } from '../../shared/utils/archives';
import { downloadBlob } from '../../shared/utils/download';

export async function downloadImages(keys: readonly string[]): Promise<void> {
  if (!keys.length) return;
  try {
    if (keys.length === 1) {
      const [archive, path] = splitArchiveKey(keys[0]);
      const name = imageFileName(keys[0]);
      downloadBlob(await extractArchiveFile(archive, path), name);
      showToast(`${name} を書き出しました`, 'success');
    } else {
      const file = await exportImages([...keys]);
      downloadBlob(file.blob, file.name);
      showToast(`画像 ${keys.length} 枚を ${file.name} に書き出しました`, 'success');
    }
  } catch (err) {
    showError('画像を書き出せませんでした', err);
  }
}
