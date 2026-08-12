export interface Command {
  execute(): Promise<void> | void;
  undo(): Promise<void> | void;
  label: string;
}

class HistoryManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  public async execute(command: Command) {
    await command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
    this.emitChange();
  }

  public push(command: Command) {
    this.undoStack.push(command);
    this.redoStack = [];
    this.emitChange();
  }

  public async undo() {
    if (this.undoStack.length === 0) return;
    const command = this.undoStack.pop()!;
    console.log('Undo:', command.label);
    await command.undo();
    this.redoStack.push(command);
    this.emitChange();
  }

  public async redo() {
    if (this.redoStack.length === 0) return;
    const command = this.redoStack.pop()!;
    console.log('Redo:', command.label);
    await command.execute();
    this.undoStack.push(command);
    this.emitChange();
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private emitChange() {
    window.dispatchEvent(new Event('history:changed'));
  }
}

export const historyManager = new HistoryManager();
