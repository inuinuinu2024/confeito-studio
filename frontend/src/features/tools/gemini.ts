import { Tool, ToolContext } from '../../shared/types/tool.types';
import { showToast } from '../../shared/utils/toast';

export class GeminiGenerationTool implements Tool {
  id = 'gemini-generation';
  name = 'Gemini Gen';
  icon = 'auto_awesome';
  hasSettings = true;

  async execute(context: ToolContext): Promise<void> {
    const compositeCanvas = await context.getCompositeImage();
    if (!compositeCanvas) {
      throw new Error('No composite image available. Please load a document first.');
    }

    const prompts = context.getPrompts(this.name);
    if (!prompts.prompt.trim()) {
      throw new Error('Prompt is required. Please set it via the Edit button next to the tool, or use the global prompt field.');
    }

    showToast('Generating image with Gemini API...', 'info');

    // Convert canvas to blob
    const blob = await new Promise<Blob | null>((resolve) => {
      compositeCanvas.toBlob(resolve, 'image/png');
    });

    if (!blob) {
      throw new Error('Failed to create image blob from canvas.');
    }

    // Prepare form data
    const formData = new FormData();
    formData.append('image', blob, 'composite.png');
    formData.append('prompt', prompts.prompt);

    // Get API Key from LocalStorage
    const apiKey = localStorage.getItem('geminiApiKey');
    if (!apiKey) {
      throw new Error('Gemini API Key is not set. Please configure it in the Settings (gear icon in TopBar).');
    }

    // Call backend API
    const response = await fetch('http://127.0.0.1:8000/api/generate', {
      method: 'POST',
      headers: {
        'x-gemini-api-key': apiKey
      },
      body: formData,
    });

    if (!response.ok) {
      let errorMsg = `API Error (${response.status})`;
      try {
        const errorData = await response.json();
        if (errorData && errorData.detail) {
          errorMsg = errorData.detail;
        } else {
          errorMsg = JSON.stringify(errorData);
        }
      } catch {
        errorMsg = await response.text();
      }
      throw new Error(errorMsg);
    }

    const resultBlob = await response.blob();

    // Save to cache
    await context.cacheResult(resultBlob, this.name);
  }
}
