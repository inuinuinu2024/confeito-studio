/**
 * /api/archives — folder-based archive storage (backend/src/app/services/archive_service.py).
 *
 * Keys are "<archive>/<relative path>"; use `splitArchiveKey` to split them.
 */
import type { ArchiveEntry } from '../types/archive';
import { formData, postJson, request, requestJson } from './http';

const enc = encodeURIComponent;

/** Top-level archive folders, newest first. Returns [] if the backend is unreachable. */
export async function getArchives(): Promise<ArchiveEntry[]> {
  try {
    return await requestJson<ArchiveEntry[]>('/archives');
  } catch (err) {
    console.error('Failed to fetch archives:', err);
    return [];
  }
}

/** Every folder and file inside one archive (flat list linked by folderId). [] on failure. */
export async function getArchiveContents(archiveName: string): Promise<ArchiveEntry[]> {
  try {
    return await requestJson<ArchiveEntry[]>(`/archives/${enc(archiveName)}/contents`);
  } catch (err) {
    console.error('Failed to fetch archive contents:', err);
    return [];
  }
}

export async function extractArchiveFile(archiveName: string, path: string): Promise<Blob> {
  return (await request(`/archives/${enc(archiveName)}/extract?path=${enc(path)}`)).blob();
}

/** Downloads the file behind an archive key ("<archive>/<path>"); null if missing. */
export async function fetchArchiveKey(key: string): Promise<Blob | null> {
  const [archive, path] = splitArchiveKey(key);
  if (!path) return null;
  try {
    return await extractArchiveFile(archive, path);
  } catch {
    return null;
  }
}

/** Creates the archive if needed and writes each blob to its relative path. */
export async function saveArchive(name: string, files: { blob: Blob; path: string }[]): Promise<void> {
  const form = formData({ name });
  for (const f of files) {
    form.append('files', f.blob, f.path);
    form.append('paths', f.path);
  }
  await request('/archives', { method: 'POST', body: form });
}

/** Moves an archive to .trash (undo with restoreArchive). */
export async function deleteArchive(archiveName: string): Promise<void> {
  await request(`/archives/${enc(archiveName)}`, { method: 'DELETE' });
}

/** Moves files / sub folders to .trash/.items (undo with restoreArchiveContents). */
export async function deleteArchiveContents(archiveName: string, paths: string[]): Promise<void> {
  await postJson(`/archives/${enc(archiveName)}/delete_contents`, { paths });
}

/** Moves files / sub folders deleted with deleteArchiveContents back to their paths. */
export async function restoreArchiveContents(archiveName: string, paths: string[]): Promise<void> {
  await postJson(`/archives/${enc(archiveName)}/restore_contents`, { paths });
}

export async function restoreArchive(archiveName: string): Promise<void> {
  await request(`/archives/${enc(archiveName)}/restore`, { method: 'POST' });
}

/** Appends a line to `<archive>/<fileName>` (archive must be a top-level name, not a sub path). */
export async function appendArchiveLog(archiveName: string, message: string, fileName = 'log.txt'): Promise<void> {
  await postJson(`/archives/${enc(archiveName)}/log`, { message, file_name: fileName });
}

/** Saves files into a folder key: "root" or a sub folder such as "root/sub". */
export async function saveToFolder(folderKey: string, files: { blob: Blob; path: string }[]): Promise<void> {
  const [root, sub] = splitArchiveKey(folderKey);
  await saveArchive(
    root,
    files.map(f => ({ blob: f.blob, path: sub ? `${sub}/${f.path}` : f.path })),
  );
}

/** Appends to the log file at the top-level archive of a folder key ("root/sub" logs to root). */
export async function appendFolderLog(folderKey: string, message: string, fileName = 'log.txt'): Promise<void> {
  await appendArchiveLog(splitArchiveKey(folderKey)[0], message, fileName);
}

/** "root/sub/file.png" -> ["root", "sub/file.png"]; "root" -> ["root", ""]. */
export function splitArchiveKey(key: string): [string, string] {
  const clean = key.replace(/\\/g, '/');
  const slash = clean.indexOf('/');
  return slash === -1 ? [clean, ''] : [clean.slice(0, slash), clean.slice(slash + 1)];
}
