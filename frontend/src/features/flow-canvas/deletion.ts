/**
 * Deleting results from the flow canvas and undoing it (docs/specs/flow-canvas.md 「削除」).
 * Each target (archive / page / result folder) is moved to the trash with its own request, so a
 * deletion that fails half way still records exactly what was moved; undo (Ctrl+Z) moves those back.
 */
import {
  deleteArchive,
  deleteArchiveContents,
  restoreArchive,
  restoreArchiveContents,
  splitArchiveKey,
} from '../../shared/api/archives';
import { ApiError } from '../../shared/api/http';
import { emit } from '../../shared/events';
import { showError, showToast } from '../../shared/ui/toast';
import { historyManager, type UndoEntry } from '../../shared/utils/history';
import type { DeletionPlan, FlowGraph } from './flow-graph';

export interface DeletionTarget {
  archive: string;
  /** Path inside the archive ('' for the whole archive). */
  path: string;
  /** Shown in the toasts. */
  name: string;
}

export function targetsLabel(targets: readonly DeletionTarget[]): string {
  return targets.length === 1 ? `「${targets[0].name}」を` : `${targets.length} 件を`;
}

/** The trash requests for a plan: the archive itself, or its pages and result folders. */
export function deletionTargets(graph: FlowGraph, plan: DeletionPlan): DeletionTarget[] {
  if (plan.whole) return [{ archive: graph.archive, path: '', name: graph.archive }];
  const target = (key: string, name: string) => ({ archive: graph.archive, path: splitArchiveKey(key)[1], name });
  return [
    ...plan.roots.map(root => target(root.key, root.name)),
    ...plan.runs.map(folder => target(folder, splitArchiveKey(folder)[1])),
  ];
}

interface Outcome {
  done: DeletionTarget[];
  failed: { target: DeletionTarget; error: unknown }[];
}

/** Runs `action` for each target in turn (one request at a time, in order). */
async function forEach(
  targets: readonly DeletionTarget[],
  action: (target: DeletionTarget) => Promise<void>,
): Promise<Outcome> {
  const outcome: Outcome = { done: [], failed: [] };
  for (const target of targets) {
    try {
      await action(target);
      outcome.done.push(target);
    } catch (error) {
      console.error(`Failed for ${target.archive}/${target.path}`, error);
      outcome.failed.push({ target, error });
    }
  }
  return outcome;
}

const trash = (t: DeletionTarget) => (t.path ? deleteArchiveContents(t.archive, [t.path]) : deleteArchive(t.archive));
const restore = (t: DeletionTarget) =>
  t.path ? restoreArchiveContents(t.archive, [t.path]) : restoreArchive(t.archive);

function undoEntry(targets: DeletionTarget[]): UndoEntry {
  return {
    async undo() {
      const { done, failed } = await forEach([...targets].reverse(), restore);
      if (done.length) showToast(`${targetsLabel(done)}元に戻しました`, 'success');
      if (failed.length) {
        showError(`${targetsLabel(failed.map(f => f.target))}元に戻せませんでした`, failed[0].error);
      }
      // Show the archive again (a deleted archive comes back as the shown one).
      emit('archives:changed', { select: [], archive: targets[0].archive });
      // Kept for the next undo, except what is no longer in the trash (it can never come back).
      const retry = failed
        .filter(f => !(f.error instanceof ApiError && f.error.status === 404))
        .map(f => f.target)
        .reverse();
      return retry.length ? undoEntry(retry) : null;
    },
  };
}

/** Moves `targets` to the trash (after any queued deletion / undo) and records what was moved for undo. */
export function deleteTargets(targets: DeletionTarget[]): Promise<void> {
  return historyManager.perform(async () => {
    const { done, failed } = await forEach(targets, trash);
    if (done.length) showToast(`${targetsLabel(done)}削除しました`, 'success');
    if (failed.length) {
      showError(`${targetsLabel(failed.map(f => f.target))}削除できませんでした`, failed[0].error);
    }
    emit('archives:changed', { select: [] });
    return done.length ? undoEntry(done) : null;
  });
}
