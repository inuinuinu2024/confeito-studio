/**
 * What a tool runs on and how a run of several images is reported (docs/specs/ai-panel.md 「まとめて実行」).
 * Pure functions; tool-runner.ts does the running.
 */
import type { FlowImage } from '../../shared/types/flow';
import { type RunTarget, type Tool, ToolNotReady } from '../../shared/types/tool';

export const SELECT_IMAGE = 'キャンバスで対象の画像を選択してください。';

/** The targets of one run of `tool` (throws ToolNotReady when there is nothing to run on). */
export function planTargets(tool: Pick<Tool, 'targets'>, selection: readonly FlowImage[]): (RunTarget | null)[] {
  const targets = tool.targets ? tool.targets(selection) : [...selection];
  if (!targets.length) throw new ToolNotReady(SELECT_IMAGE);
  return targets;
}

/** Status bar text before each image of a run of several: "(2/5) page.png". */
export function progressMessage(index: number, total: number, target: RunTarget | null): string {
  return `(${index + 1}/${total})${target ? ` ${target.name}` : ''}`;
}

/** The toast after a run of several targets ("<tool>: …"); `failed` 0 is a success. */
export function batchSummary(total: number, succeeded: number, failed: number): string {
  if (!failed) return `${total} 件を処理しました`;
  return `${total} 件中 ${succeeded} 件成功・${failed} 件失敗しました`;
}

/** The toast after a stopped run of several targets. */
export function stoppedSummary(total: number, finished: number): string {
  return total > 1 ? `実行を停止しました（${total} 件中 ${finished} 件完了）` : '実行を停止しました';
}
