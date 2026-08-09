import type { Psd, Layer } from 'ag-psd';

export interface ToolContext {
  psd: Psd | null;
  selectedLayer: Layer | null;
  
  // Get the canvas of the currently selected layer
  getSelectedImage(): Promise<HTMLCanvasElement | null>;
  
  // Cache the result and return a cache key
  cacheResult(image: HTMLCanvasElement | Blob, toolName: string): Promise<string>;
}

export interface Tool {
  id: string;
  name: string;
  icon: string; // Material symbols icon name
  execute(context: ToolContext): Promise<void>;
}
