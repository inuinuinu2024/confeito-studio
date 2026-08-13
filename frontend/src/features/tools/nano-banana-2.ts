import { Tool, ToolContext } from '../../shared/types/tool.types';

export class NanoBanana2Tool implements Tool {
  id = 'nano-banana-2';
  name = 'Nano Banana 2（未作成）';
  icon = 'auto_awesome';
  hasSettings = true;

  async execute(context: ToolContext): Promise<void> {
    throw new Error('この機能はまだ実装されていません。');
  }
}
