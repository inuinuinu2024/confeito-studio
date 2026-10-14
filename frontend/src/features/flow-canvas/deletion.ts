/**
 * Deleting results from the flow canvas and undoing it (docs/specs/flow-canvas.md 「削除」).
 * Each target (archive / page / result folder) is moved to the trash with its own request, so a
 * deletion that fails half way still records exactly what was moved; undo (Ctrl+Z) moves those back.
 * Panels of a コマ分割 deleted one by one are marked in the archive (.flow.json) instead; undo clears the marks.
 */
import {
  deleteArchive,
  deleteArchiveContents,
  restoreArchive,
  restoreArchiveContents,
  setFlowRemoved,
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

/**
 * The trash requests for a plan: the archive itself (shown as `archiveName`, its display name), or its
 * pages and result folders.
 */
export function deletionTargets(graph: FlowGraph, plan: DeletionPlan, archiveName = graph.archive): DeletionTarget[] {
  if (plan.whole) return [{ archive: graph.archive, path: '', name: archiveName }];
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

/** Panels of a コマ分割 deleted one by one: the archive and their image keys. */
export interface RemovedPanels {
  archive: string;
  keys: string[];
  /** "コマ 2" (or "2 コマ"), shown in the toasts. */
  label: string;
}

/** "コマ 2 " / "コマ 2 と結果 3 件" (the panels and the results moved with them), for one toast. */
const panelsLabel = (panels: RemovedPanels, done: readonly DeletionTarget[]) =>
  done.length ? `${panels.label} と結果 ${done.length} 件` : `${panels.label} `;

/** Marks (`removed`) or unmarks the panels; true when every mark was saved. */
async function markPanels(panels: RemovedPanels, removed: boolean): Promise<boolean> {
  try {
    for (const key of panels.keys) await setFlowRemoved(panels.archive, key, removed);
    return true;
  } catch (err) {
    showError(removed ? `${panels.label} を削除できませんでした` : `${panels.label} を元に戻せませんでした`, err);
    return false;
  }
}

function undoEntry(targets: DeletionTarget[], panels: RemovedPanels | null = null): UndoEntry {
  return {
    // やり直し: the same deletion again.
    redo: () => applyDeletion(targets, panels),
    async undo() {
      const { done, failed } = await forEach([...targets].reverse(), restore);
      const unmarked = panels ? await markPanels(panels, false) : false;
      if (unmarked && panels) showToast(`${panelsLabel(panels, done)}を元に戻しました`, 'success');
      else if (done.length) showToast(`${targetsLabel(done)}元に戻しました`, 'success');
      if (failed.length) {
        showError(`${targetsLabel(failed.map(f => f.target))}元に戻せませんでした`, failed[0].error);
      }
      // Show the archive again (a deleted archive comes back as the shown one).
      emit('archives:changed', { select: [], archive: targets[0]?.archive ?? panels?.archive });
      // Kept for the next undo, except what is no longer in the trash (it can never come back).
      const retry = failed
        .filter(f => !(f.error instanceof ApiError && f.error.status === 404))
        .map(f => f.target)
        .reverse();
      return retry.length || (panels && !unmarked) ? undoEntry(retry, unmarked ? null : panels) : null;
    },
  };
}

/**
 * Moves `targets` to the trash and marks `panels` as deleted (after any queued deletion / undo), and records what
 * was done for undo.
 */
export function deleteTargets(targets: DeletionTarget[], panels: RemovedPanels | null = null): Promise<void> {
  return historyManager.perform(() => applyDeletion(targets, panels));
}

/** Moves `targets` to the trash and marks `panels`; resolves the entry undoing what was done (null: nothing). */
async function applyDeletion(targets: DeletionTarget[], panels: RemovedPanels | null): Promise<UndoEntry | null> {
  const { done, failed } = await forEach(targets, trash);
  const marked = panels && (await markPanels(panels, true)) ? panels : null;
  if (marked) showToast(`${panelsLabel(marked, done)}を削除しました`, 'success');
  else if (done.length) showToast(`${targetsLabel(done)}削除しました`, 'success');
  if (failed.length) {
    showError(`${targetsLabel(failed.map(f => f.target))}削除できませんでした`, failed[0].error);
  }
  emit('archives:changed', { select: [] });
  return done.length || marked ? undoEntry(done, marked) : null;
}
