import { Tool, ToolContext } from '../../shared/types/tool.types';
import { showToast } from '../../shared/utils/toast';

export class NanoBananaProTool implements Tool {
  id = 'nano-banana-pro';
  name = 'Nano Banana Pro';
  icon = 'auto_awesome';
  hasSettings = true;

  async execute(context: ToolContext): Promise<void> {
    showToast(`${this.name} is a placeholder and not implemented yet.`, 'info');
  }
}

export class NanoBanana2Tool implements Tool {
  id = 'nano-banana-2';
  name = 'Nano Banana 2';
  icon = 'auto_awesome';
  hasSettings = true;

  async execute(context: ToolContext): Promise<void> {
    showToast(`${this.name} is a placeholder and not implemented yet.`, 'info');
  }
}
