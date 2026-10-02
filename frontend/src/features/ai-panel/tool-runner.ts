/**
 * Runs a tool: emits tool:start/tool:end (status bar), shows the result toast, and records
 * failures in error.txt — appended to the current archive folder, or saved as a new
 * "<stamp>_<tool>_error" archive when no folder is selected. Tools that saved their own
 * error report throw `ToolError(message, archiveSaved = true)` to skip this.
 */
import { appendFolderLog, saveArchive } from '../../shared/api/archives';
import { emit } from '../../shared/events';
import type { Tool, ToolContext } from '../../shared/types/tool';
import { showToast } from '../../shared/ui/toast';
import { fileStamp } from '../../shared/utils/datetime';
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

async function recordError(tool: Tool, message: string): Promise<void> {
  const stamp = fileStamp();
  const line = `[${stamp}] (${tool.name}): ${message}\n`;
  const folder = DocumentManager.getInstance().getCurrentArchiveFolder();
  if (folder) await appendFolderLog(folder, line, 'error.txt');
  else
    await saveArchive(`${stamp}_${tool.name}_error`, [
      { blob: new Blob([line], { type: 'text/plain' }), path: 'error.txt' },
    ]);
  emit('archives:changed');
}

/** Executes the tool; resolves true on success. Never throws. */
export async function runTool(tool: Tool): Promise<boolean> {
  emit('tool:start', { toolName: tool.name });
  try {
    await tool.execute(createToolContext());
    showToast(`${tool.name} completed.`, 'success');
    return true;
  } catch (err) {
    if (isCancellation(err)) return false;
    console.error(err);
    const message = (err as Error)?.message || 'Unknown error';
    showToast(`${tool.name} failed: ${message}`, 'error');
    if (!(err as { archiveSaved?: boolean })?.archiveSaved) {
      await recordError(tool, message).catch(e => console.error('Failed to save error cache:', e));
    }
    return false;
  } finally {
    emit('tool:end');
  }
}
