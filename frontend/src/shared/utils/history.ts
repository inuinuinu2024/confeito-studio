/** Undo/redo stack (Ctrl+Z / Ctrl+Y). Currently used for archive deletion. */
import { emit } from '../events';

export interface Command {
  label: string;
  execute(): Promise<void> | void;
  undo(): Promise<void> | void;
}

class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  /** Runs the command and records it. */
  async execute(command: Command): Promise<void> {
    await command.execute();
    this.push(command);
  }

  /** Records an already-performed command. */
  push(command: Command): void {
    this.undoStack.push(command);
    this.redoStack = [];
    emit('history:changed');
  }

  async undo(): Promise<void> {
    const command = this.undoStack.pop();
    if (!command) return;
    await command.undo();
    this.redoStack.push(command);
    emit('history:changed');
  }

  async redo(): Promise<void> {
    const command = this.redoStack.pop();
    if (!command) return;
    await command.execute();
    this.undoStack.push(command);
    emit('history:changed');
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

export const historyManager = new HistoryManager();
