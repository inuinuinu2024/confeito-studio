/**
 * /api/archives — folder-based archive storage (backend/src/app/services/archive_service.py).
 *
 * Keys are "<archive>/<relative path>"; use `splitArchiveKey` to split them.
 */
import type { ArchiveEntry } from '../types/archive';
import type { FlowData } from '../types/flow';
import { formData, postForm, postJson, request, requestJson } from './http';

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

/** What a tool tells about its result; the backend writes it as info.json (docs/specs/archives.md). */
export interface ResultInfo {
  tool: string;
  /** Archive key of the input (image or folder), or null. */
  source: string | null;
  /** Every input image when there are several. */
  sources?: string[];
  settings: Record<string, unknown>;
}

/** Roots, tool runs and the shown run of each stack of one archive (Normal mode canvas). */
export function getFlow(archiveName: string): Promise<FlowData> {
  return requestJson<FlowData>(`/archives/${enc(archiveName)}/flow`);
}

/** Records the run shown for a stack (null: back to the newest run). */
export async function setFlowSelection(archiveName: string, stack: string, folder: string | null): Promise<void> {
  await request(`/archives/${enc(archiveName)}/flow/selection`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stack, folder }),
  });
}

/** Marks `image` as what コマ結合 pastes for `panel` (null: back to the newest image made from the panel). */
export async function setFlowMerge(archiveName: string, panel: string, image: string | null): Promise<void> {
  await request(`/archives/${enc(archiveName)}/flow/merge`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ panel, image }),
  });
}

/** A copy of the image behind `key` at most `size` px on its long side. */
export async function fetchThumbnail(key: string, size: number, signal?: AbortSignal): Promise<Blob> {
  const [archive, path] = splitArchiveKey(key);
  return (await request(`/archives/${enc(archive)}/thumbnail?path=${enc(path)}&size=${size}`, { signal })).blob();
}

/**
 * Saves a tool result into "<root>/<name>/" (a new archive "<name>" when `root` is null) and,
 * with `info`, an info.json. Resolves with the folder key actually used: an existing folder
 * is never overwritten ("_2", "_3", ... is appended).
 */
export async function saveResult(opts: {
  root: string | null;
  name: string;
  info: ResultInfo | null;
  files: { blob: Blob; path: string }[];
}): Promise<string> {
  const form = formData({ root: opts.root, name: opts.name, info: opts.info && JSON.stringify(opts.info) });
  for (const f of opts.files) {
    form.append('files', f.blob, f.path);
    form.append('paths', f.path);
  }
  return (await postForm<{ folder: string }>('/archives/results', form)).folder;
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

/** "root/sub/file.png" -> ["root", "sub/file.png"]; "root" -> ["root", ""]. */
export function splitArchiveKey(key: string): [string, string] {
  const clean = key.replace(/\\/g, '/');
  const slash = clean.indexOf('/');
  return slash === -1 ? [clean, ''] : [clean.slice(0, slash), clean.slice(slash + 1)];
}
