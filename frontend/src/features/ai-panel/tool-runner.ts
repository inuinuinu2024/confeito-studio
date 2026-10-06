/**
 * Runs a tool: emits tool:start/tool:end (status bar, tool list) and reports the outcome with one toast
 * (docs/specs/notifications.md): the tool's summary on success, a warning when an input is
 * missing, and an error toast (message + original text) on failure. Nothing is written to the archives.
 *
 * A tool runs once per target (docs/specs/ai-panel.md 「まとめて実行」): every image selected on the canvas
 * by default (run-targets.ts), one after another. A missing input on the first target stops the run with a
 * warning; later failures are skipped and counted, and the cell is marked (`tool:target`).
 * One tool runs at a time; another run started meanwhile only gets a warning.
 * `stopTool()` stops the run at once (docs/specs/ai-panel.md 「実行の停止」): the tool sees its signal
 * aborted and throws its result away, finishing in the background; the remaining targets are skipped.
 */
import { fetchArchiveKey } from '../../shared/api/archives';
import { emit } from '../../shared/events';
import { saveSettings } from '../../shared/state/tool-settings';
import { type RunTarget, type Tool, type ToolContext, ToolNotReady } from '../../shared/types/tool';
import { showError, showToast } from '../../shared/ui/toast';
import { blobToCanvas } from '../../shared/utils/image';
import { DocumentManager } from '../document/DocumentManager';
import { batchSummary, planTargets, progressMessage, stoppedSummary } from './run-targets';

let running: { name: string; controller: AbortController } | null = null;

export function createToolContext(
  target: RunTarget | null,
  signal: AbortSignal,
  onReady: () => void = () => {},
): ToolContext {
  let readyCalled = false;
  return {
    target,
    async getSelectedImage() {
      const blob = target ? await fetchArchiveKey(target.key) : null;
      return blob ? blobToCanvas(blob) : null;
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

const markTarget = (target: RunTarget | null, state: 'running' | 'done' | 'failed') => {
  if (target) emit('tool:target', { key: target.key, state });
};

/**
 * Executes the tool on each target; resolves true when every run succeeded. Never throws.
 * The tool's changed settings are saved first, so they are kept even when the run fails
 * (a failed save shows its own error toast and the run goes on).
 * `onReady` is called when the tool has checked its inputs (`ToolContext.ready`, first target).
 */
export async function runTool(
  tool: Pick<Tool, 'name' | 'execute' | 'settingsPrefix' | 'targets'>,
  onReady?: () => void,
): Promise<boolean> {
  if (warnIfToolRunning(tool.name)) return false;
  let targets: (RunTarget | null)[];
  try {
    targets = planTargets(tool, DocumentManager.getInstance().getSelection());
  } catch (err) {
    if (err instanceof ToolNotReady) showToast(`${tool.name}: ${err.message}`, 'warning');
    else showError(`${tool.name}の実行に失敗しました`, err);
    return false;
  }

  const controller = new AbortController();
  const { signal } = controller;
  running = { name: tool.name, controller };
  emit('tool:start', { toolName: tool.name });
  const total = targets.length;
  const failures: unknown[] = [];
  let succeeded = 0;
  let summary = '';
  try {
    if (tool.settingsPrefix) await saveSettings(tool.settingsPrefix);
    for (const [index, target] of targets.entries()) {
      signal.throwIfAborted();
      if (total > 1) emit('tool:progress', { message: progressMessage(index, total, target) });
      markTarget(target, 'running');
      try {
        const execution = tool.execute(createToolContext(target, signal, onReady));
        // After a stop the tool finishes in the background (removing what it saved); nothing is reported.
        execution.catch(err => {
          if (signal.aborted && !isCancellation(err)) console.warn(`${tool.name} (stopped):`, err);
        });
        summary = await Promise.race([execution, whenAborted(signal)]);
        succeeded++;
        markTarget(target, 'done');
      } catch (err) {
        if (signal.aborted || isCancellation(err)) {
          markTarget(target, 'done');
          throw err;
        }
        // Nothing ran yet and an input is missing: the whole run waits for it (the window stays open).
        if (err instanceof ToolNotReady && succeeded === 0 && failures.length === 0) throw err;
        console.error(err);
        failures.push(err);
        markTarget(target, 'failed');
      }
    }
    if (total === 1 && failures.length) {
      showError(`${tool.name}の実行に失敗しました`, failures[0]);
    } else if (total === 1) {
      showToast(`${tool.name}: ${summary}`, 'success');
    } else if (failures.length) {
      showError(`${tool.name}: ${batchSummary(total, succeeded, failures.length)}`, failures[0]);
    } else {
      showToast(`${tool.name}: ${batchSummary(total, succeeded, 0)}`, 'success');
    }
    return failures.length === 0;
  } catch (err) {
    if (signal.aborted) {
      showToast(`${tool.name}: ${stoppedSummary(total, succeeded)}`, 'info');
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
