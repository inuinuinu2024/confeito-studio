/**
 * Runs a tool: emits tool:start/tool:end (status bar, tool list) and reports the outcome with one toast
 * (docs/specs/notifications.md): the tool's summary on success, a warning when an input is
 * missing, and an error toast (message + original text) on failure. Nothing is written to the archives.
 * One tool runs at a time; another run started meanwhile only gets a warning.
 * `stopTool()` stops the run at once (docs/specs/ai-panel.md 「実行の停止」): the tool sees its signal
 * aborted and throws its result away, finishing in the background.
 */
import { emit } from '../../shared/events';
import { saveSettings } from '../../shared/state/tool-settings';
import { type Tool, type ToolContext, ToolNotReady } from '../../shared/types/tool';
import { showError, showToast } from '../../shared/ui/toast';
import { toCanvas } from '../../shared/utils/image';
import { DocumentManager } from '../document/DocumentManager';

let running: { name: string; controller: AbortController } | null = null;

export function createToolContext(signal: AbortSignal, onReady: () => void = () => {}): ToolContext {
  let readyCalled = false;
  return {
    async getSelectedImage() {
      const current = DocumentManager.getInstance().getCurrentCanvas();
      return current ? toCanvas(current) : null;
    },
    ready() {
      if (readyCalled) return;
      readyCalled = true;
      onReady();
    },
    signal,
  };
}

function isCancellation(err: unknown): boolean {
  const e = err as Error;
  return e?.name === 'AbortError' || e?.message === 'AbortError';
}

/**
 * Shows the warning and resolves true while a tool is running, so the caller does not start another
 * (docs/specs/ai-panel.md 「ツールの実行」).
 */
export function warnIfToolRunning(toolName: string): boolean {
  if (!running) return false;
  showToast(`${toolName}: 「${running.name}」の実行が終わってから実行してください`, 'warning');
  return true;
}

/** Stops the running tool (no-op when nothing runs). */
export function stopTool(): void {
  running?.controller.abort();
}

/** Rejects with an AbortError once `signal` is aborted. */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
  });
}

/**
 * Executes the tool; resolves true on success. Never throws.
 * The tool's changed settings are saved first, so they are kept even when the run fails
 * (a failed save shows its own error toast and the run goes on).
 * `onReady` is called when the tool has checked its inputs (`ToolContext.ready`).
 */
export async function runTool(
  tool: Pick<Tool, 'name' | 'execute' | 'settingsPrefix'>,
  onReady?: () => void,
): Promise<boolean> {
  if (warnIfToolRunning(tool.name)) return false;
  const controller = new AbortController();
  running = { name: tool.name, controller };
  emit('tool:start', { toolName: tool.name });
  try {
    if (tool.settingsPrefix) await saveSettings(tool.settingsPrefix);
    controller.signal.throwIfAborted();
    const execution = tool.execute(createToolContext(controller.signal, onReady));
    // After a stop the tool finishes in the background (removing what it saved); nothing is reported.
    execution.catch(err => {
      if (controller.signal.aborted && !isCancellation(err)) console.warn(`${tool.name} (stopped):`, err);
    });
    const summary = await Promise.race([execution, whenAborted(controller.signal)]);
    showToast(`${tool.name}: ${summary}`, 'success');
    return true;
  } catch (err) {
    if (controller.signal.aborted) {
      showToast(`${tool.name}: 実行を停止しました`, 'info');
      return false;
    }
    if (isCancellation(err)) return false;
    if (err instanceof ToolNotReady) {
      showToast(`${tool.name}: ${err.message}`, 'warning');
      return false;
    }
    console.error(err);
    showError(`${tool.name}の実行に失敗しました`, err);
    return false;
  } finally {
    running = null;
    emit('tool:end');
  }
}
