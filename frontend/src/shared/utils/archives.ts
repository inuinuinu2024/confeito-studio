import { CachedImage } from '../types/archive.types';

const API_BASE = 'http://127.0.0.1:48000/api';

export async function getArchives(): Promise<CachedImage[]> {
  try {
    const res = await fetch(`${API_BASE}/archives`);
    if (res.ok) {
      return await res.json();
    }
    console.error(`Failed to fetch archives (status: ${res.status})`);
  } catch (err) {
    console.error(`Failed to fetch archives:`, err);
  }
  return [];
}

export async function getArchiveContents(archiveName: string): Promise<CachedImage[]> {
  try {
    const res = await fetch(`${API_BASE}/archives/${encodeURIComponent(archiveName)}/contents`);
    if (res.ok) {
      return await res.json();
    }
    console.error(`Failed to fetch archive contents (status: ${res.status})`);
  } catch (err) {
    console.error(`Failed to fetch archive contents:`, err);
  }
  return [];
}

export async function extractArchiveFile(archiveName: string, path: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/archives/${encodeURIComponent(archiveName)}/extract?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    throw new Error('Failed to extract file');
  }
  return await res.blob();
}

export async function deleteArchive(archiveName: string): Promise<void> {
  const res = await fetch(`${API_BASE}/archives/${encodeURIComponent(archiveName)}`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    throw new Error('Failed to delete archive');
  }
}

export async function deleteArchiveContents(archiveName: string, paths: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/archives/${encodeURIComponent(archiveName)}/delete_contents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ paths })
  });
  if (!res.ok) {
    throw new Error('Failed to delete archive contents');
  }
}

export async function restoreArchive(archiveName: string): Promise<void> {
  const res = await fetch(`${API_BASE}/archives/${encodeURIComponent(archiveName)}/restore`, {
    method: 'POST'
  });
  if (!res.ok) {
    throw new Error('Failed to restore archive');
  }
}

export async function saveArchive(name: string, files: { blob: Blob, path: string }[]): Promise<void> {
  const formData = new FormData();
  formData.append('name', name);
  
  for (const f of files) {
    formData.append('files', f.blob, f.path);
    formData.append('paths', f.path);
  }
  
  const res = await fetch(`${API_BASE}/archives`, {
    method: 'POST',
    body: formData
  });
  
  if (!res.ok) {
    throw new Error('Failed to save archive');
  }
}

export async function appendArchiveLog(archiveName: string, message: string, fileName: string = 'log.txt'): Promise<void> {
  const res = await fetch(`${API_BASE}/archives/${encodeURIComponent(archiveName)}/log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message, file_name: fileName })
  });
  if (!res.ok) {
    throw new Error('Failed to append to archive log');
  }
}

// Keep track of folder collapsed states in-memory so they reset on app startup
const collapseState: Record<string, boolean> = {};

export function getArchiveCollapseState(): Record<string, boolean> {
  return collapseState;
}

export function updateArchiveFolderCollapse(key: string, collapsed: boolean) {
  collapseState[key] = collapsed;
}

