export interface ToolContext {
  image?: HTMLCanvasElement | null;
  psd?: any;
  selectedLayer?: any;
  
  // Get the canvas of the currently active or selected image
  getSelectedImage(): Promise<HTMLCanvasElement | null>;
  
  // Get the composite or main image
  getCompositeImage(): Promise<HTMLCanvasElement | null>;

  // Get the positive and negative prompts from AI Panel
  getPrompts(toolName?: string): { prompt: string };
}

export interface Tool {
  id: string;
  name: string;
  icon?: string; // Material symbols icon name
  hasSettings?: boolean;
  renderSettings?: (container: HTMLElement) => void;
  executeLabel?: string;
  executeIcon?: string | null;
  execute(context: ToolContext): Promise<void>;
}
