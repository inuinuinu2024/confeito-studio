/**
 * Saving a tool result by the archive rules (docs/specs/archives.md 「ツールの結果の保存」):
 * "<selected archive>/<YYYYMMDD_HHMMSS>_<tool name>/" — or a new archive of that name when
 * nothing is selected — with info.json. The backend picks a free name ("_2", ...).
 */
import {
  deleteArchive,
  deleteArchiveContents,
  type ResultInfo,
  saveResult,
  splitArchiveKey,
} from '../../shared/api/archives';
import { fileStamp } from '../../shared/utils/datetime';
import { DocumentManager } from '../document/DocumentManager';

/** Top-level archive of the current save folder, or null when nothing is selected. */
export function selectedArchive(): string | null {
  const folder = DocumentManager.getInstance().getCurrentArchiveFolder();
  return folder ? splitArchiveKey(folder)[0] : null;
}

/** Saves `files` (+ info.json) and resolves with the result folder key. */
export function saveToolResult(
  toolName: string,
  files: { blob: Blob; path: string }[],
  info: Omit<ResultInfo, 'tool'>,
  stamp = fileStamp(),
): Promise<string> {
  return saveResult({
    root: selectedArchive(),
    name: `${stamp}_${toolName}`,
    info: { tool: toolName, ...info },
    files,
  });
}

/**
 * When the run was stopped, removes the result already saved at `folder` (a result folder key or a
 * new archive; moved to .trash like a deletion in ARCHIVES) and throws the abort reason.
 * Call it right after a result is saved, before announcing it (docs/specs/ai-panel.md 「実行の停止」).
 */
export async function discardIfStopped(signal: AbortSignal, folder: string): Promise<void> {
  if (!signal.aborted) return;
  const [archive, rest] = splitArchiveKey(folder);
  if (rest) await deleteArchiveContents(archive, [rest]);
  else await deleteArchive(archive);
  signal.throwIfAborted();
}
