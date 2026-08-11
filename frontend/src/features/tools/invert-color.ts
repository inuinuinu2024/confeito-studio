import { Tool, ToolContext } from '../../shared/types/tool.types';

export class InvertColorTool implements Tool {
  id = 'invert-color';
  name = 'Invert Colors';
  icon = 'invert_colors';

  async execute(context: ToolContext): Promise<void> {
    const canvas = await context.getSelectedImage();
    if (!canvas) {
      throw new Error('No layer selected or layer has no image data.');
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];         // R
      data[i + 1] = 255 - data[i + 1]; // G
      data[i + 2] = 255 - data[i + 2]; // B
      // data[i + 3] is Alpha, keep as is
    }

    ctx.putImageData(imageData, 0, 0);

    // Save to cache
    await context.cacheResult(canvas, this.name);
  }
}
