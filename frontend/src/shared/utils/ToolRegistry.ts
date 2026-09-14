import { Tool } from '../types/tool.types';

class ToolRegistryImpl {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    this.tools.set(tool.id, tool);
  }



  getTool(idOrName: string): Tool | undefined {
    return this.tools.get(idOrName) || Array.from(this.tools.values()).find(t => t.name === idOrName);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }
}

export const ToolRegistry = new ToolRegistryImpl();
