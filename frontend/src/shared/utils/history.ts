/**
 * Undo for deletions on the flow canvas (Ctrl+Z / its undo button; docs/specs/flow-canvas.md 「削除」).
 * Each undo reverts the latest deletion still on the stack; redo (Ctrl+Y) does the latest undone one again.
 * A new deletion forgets what could be redone.
 *
 * Deletions and undos run one at a time in the order they were requested, so pressing Ctrl+Z
 * repeatedly reverts the deletions one by one, newest first. `history:changed` is emitted whenever
 * `isBusy()` / `canUndo()` may have changed.
 */
import { emit } from '../events';
import { showError, showToast } from '../ui/toast';

export interface UndoEntry {
  /**
   * Reverts the change. Resolves with the part that could not be reverted (it stays the latest entry
   * and the next undo tries it again), or null when nothing is left.
   */
  undo(): Promise<UndoEntry | null>;
  /**
   * Does the change again after it was undone completely (やり直し); resolves the entry that undoes it again, or null
   * when nothing was done. Omitted: it cannot be redone.
   */
  redo?(): Promise<UndoEntry | null>;
}

class HistoryManager {
  private stack: UndoEntry[] = [];
  /** Entries undone completely, newest last: their `redo` does them again. */
  private redoStack: UndoEntry[] = [];
  private queue: Promise<void> = Promise.resolve();
  /** Deletions / undos queued or running. */
  private pending = 0;

  /** A deletion / undo is queued or running. */
  isBusy(): boolean {
    return this.pending > 0;
  }

  /** Something can be undone and no deletion / undo is running. */
  canUndo(): boolean {
    return !this.isBusy() && this.stack.length > 0;
  }

  /** Something undone can be done again and no deletion / undo / redo is running. */
  canRedo(): boolean {
    return !this.isBusy() && this.redoStack.length > 0;
  }

  /** Runs `task` after the queued deletions / undos; the entry it resolves with becomes the latest. */
  perform(task: () => Promise<UndoEntry | null>): Promise<void> {
    return this.enqueue(async () => {
      const entry = await task();
      if (entry) {
        this.stack.push(entry);
        this.redoStack = [];
      }
    });
  }

  /** Forgets every entry (the archives folder was switched: they belong to the previous one). */
  clear(): void {
    this.stack = [];
    this.redoStack = [];
    emit('history:changed');
  }

  /** Reverts the latest entry (after the queued deletions / undos). */
  undo(): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.stack.pop();
      if (!entry) {
        showToast('元に戻す削除はありません', 'info');
        return;
      }
      let rest: UndoEntry | null = entry;
      try {
        rest = await entry.undo();
      } catch (err) {
        console.error('Undo failed', err);
        showError('削除を元に戻せませんでした', err);
      }
      if (rest) this.stack.push(rest);
      else if (entry.redo) this.redoStack.push(entry);
    });
  }

  /** Does the latest undone deletion again (after the queued deletions / undos). */
  redo(): Promise<void> {
    return this.enqueue(async () => {
      const entry = this.redoStack.pop();
      if (!entry?.redo) {
        showToast('やり直す削除はありません', 'info');
        return;
      }
      try {
        const next = await entry.redo();
        if (next) this.stack.push(next);
      } catch (err) {
        console.error('Redo failed', err);
        showError('削除をやり直せませんでした', err);
      }
    });
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    this.pending++;
    emit('history:changed');
    const run = this.queue.then(job).finally(() => {
      this.pending--;
      emit('history:changed');
    });
    this.queue = run.catch(err => console.error('History job failed', err));
    return run;
  }
}

export const historyManager = new HistoryManager();
