/**
 * Deleting ARCHIVES entries and undoing it (docs/specs/archives.md 「削除と Undo」).
 * Each target (archive / file / sub folder) is moved to the trash with its own request, so a
 * deletion that fails half way still records exactly what was moved; undo moves those back.
 */
import {
  deleteArchive,
  deleteArchiveContents,
  restoreArchive,
  restoreArchiveContents,
} from '../../shared/api/archives';
import { ApiError } from '../../shared/api/http';
import { emit } from '../../shared/events';
import { showError, showToast } from '../../shared/ui/toast';
import { historyManager, type UndoEntry } from '../../shared/utils/history';
import { type DeletionTarget, targetsLabel } from './archive-tree';

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
      emit('archives:changed');
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
    if (done.length) {
      showToast(`${targetsLabel(done)}削除しました`, 'success');
      emit('archive:selection-cleared');
    }
    if (failed.length) {
      showError(`${targetsLabel(failed.map(f => f.target))}削除できませんでした`, failed[0].error);
    }
    // Same as the refresh button: drop cached folder contents so deleted files disappear.
    emit('archives:changed');
    return done.length ? undoEntry(done) : null;
  });
}
