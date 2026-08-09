import { Tool } from '../types/tool.types';

class ToolRegistryImpl {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    this.tools.set(tool.id, tool);
  }

  getTool(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }
}

export const ToolRegistry = new ToolRegistryImpl();
