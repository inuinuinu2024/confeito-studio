import { Tool, ToolContext } from '../../shared/types/tool.types';
import { saveArchive } from '../../shared/utils/archives';

export class GrayscaleTool implements Tool {
  id = 'grayscale';
  name = 'Grayscale';

  async execute(context: ToolContext): Promise<void> {
    const originalCanvas = await context.getCompositeImage();
    if (!originalCanvas) {
      throw new Error('No composite image available.');
    }

    // Clone the canvas for grayscale manipulation
    const grayCanvas = document.createElement('canvas');
    grayCanvas.width = originalCanvas.width;
    grayCanvas.height = originalCanvas.height;
    const ctx = grayCanvas.getContext('2d');
    if (!ctx) return;
    
    // Draw the original image onto the new canvas
    ctx.drawImage(originalCanvas, 0, 0);

    const imageData = ctx.getImageData(0, 0, grayCanvas.width, grayCanvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);

    // Generate folder name using the same format as AIPanel
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
    const folderName = `${dateStr}_${timeStr}_${this.name}`;

    // Save the original composite image as 'origin.png'
    const originBlob = await new Promise<Blob | null>(res => originalCanvas.toBlob(res));
    // Save the grayscale image as 'gray.png'
    const grayBlob = await new Promise<Blob | null>(res => grayCanvas.toBlob(res));
    
    const archiveFiles: {blob: Blob, path: string}[] = [];
    if (originBlob) archiveFiles.push({blob: originBlob, path: 'origin.png'});
    if (grayBlob) archiveFiles.push({blob: grayBlob, path: 'gray.png'});
    
    await saveArchive(folderName, archiveFiles);
    window.dispatchEvent(new Event('tool:cache-updated'));
  }
}
