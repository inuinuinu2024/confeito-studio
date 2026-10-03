/**
 * Saving a tool result by the archive rules (docs/specs/archives.md 「ツールの結果の保存」):
 * "<selected archive>/<YYYYMMDD_HHMMSS>_<tool name>/" — or a new archive of that name when
 * nothing is selected — with info.json. The backend picks a free name ("_2", ...).
 */
import { type ResultInfo, saveResult, splitArchiveKey } from '../../shared/api/archives';
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
