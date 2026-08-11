import { Tool, ToolContext } from '../../shared/types/tool.types';

export class GrayscaleTool implements Tool {
  id = 'grayscale';
  name = 'Grayscale';

  async execute(context: ToolContext): Promise<void> {
    const canvas = await context.getCompositeImage();
    if (!canvas) {
      throw new Error('No composite image available.');
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
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

    // Save to cache
    await context.cacheResult(canvas, this.name);
  }
}
