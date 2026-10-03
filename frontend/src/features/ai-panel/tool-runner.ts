/**
 * Runs a tool: emits tool:start/tool:end (status bar) and reports the outcome with one toast
 * (docs/specs/notifications.md): the tool's summary on success, a warning when an input is
 * missing, and an error toast (message + original text) on failure. Nothing is written to the archives.
 */
import { emit } from '../../shared/events';
import { saveSettings } from '../../shared/state/tool-settings';
import { type Tool, type ToolContext, ToolNotReady } from '../../shared/types/tool';
import { showError, showToast } from '../../shared/ui/toast';
import { toCanvas } from '../../shared/utils/image';
import { DocumentManager } from '../document/DocumentManager';

export function createToolContext(): ToolContext {
  return {
    async getSelectedImage() {
      const current = DocumentManager.getInstance().getCurrentCanvas();
      return current ? toCanvas(current) : null;
    },
  };
}

function isCancellation(err: unknown): boolean {
  const e = err as Error;
  return e?.name === 'AbortError' || e?.message === 'AbortError';
}

/**
 * Executes the tool; resolves true on success. Never throws.
 * The tool's changed settings are saved first, so they are kept even when the run fails
 * (a failed save shows its own error toast and the run goes on).
 */
export async function runTool(tool: Pick<Tool, 'name' | 'execute' | 'settingsPrefix'>): Promise<boolean> {
  emit('tool:start', { toolName: tool.name });
  try {
    if (tool.settingsPrefix) await saveSettings(tool.settingsPrefix);
    const summary = await tool.execute(createToolContext());
    showToast(`${tool.name}: ${summary}`, 'success');
    return true;
  } catch (err) {
    if (isCancellation(err)) return false;
    if (err instanceof ToolNotReady) {
      showToast(`${tool.name}: ${err.message}`, 'warning');
      return false;
    }
    console.error(err);
    showError(`${tool.name}の実行に失敗しました`, err);
    return false;
  } finally {
    emit('tool:end');
  }
}
