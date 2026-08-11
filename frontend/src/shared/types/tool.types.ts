import type { Psd, Layer } from 'ag-psd';

export interface ToolContext {
  psd: Psd | null;
  selectedLayer: Layer | null;
  
  // Get the canvas of the currently selected layer
  getSelectedImage(): Promise<HTMLCanvasElement | null>;
  
  // Get the composite image of all visible layers
  getCompositeImage(): Promise<HTMLCanvasElement | null>;

  // Get the positive and negative prompts from AI Panel
  getPrompts(toolName?: string): { prompt: string };

  // Cache the result and return a cache key
  cacheResult(image: HTMLCanvasElement | Blob, toolName: string): Promise<string>;
}

export interface Tool {
  id: string;
  name: string;
  icon: string; // Material symbols icon name
  hasSettings?: boolean;
  execute(context: ToolContext): Promise<void>;
}
