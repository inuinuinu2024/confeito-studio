import { CachedImage } from './idb'; // Reusing the type

const API_BASE = 'http://127.0.0.1:48000/api';

export async function getArchives(retries = 5, delayMs = 1000): Promise<CachedImage[]> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API_BASE}/archives`);
      if (res.ok) {
        return await res.json();
      }
      console.error(`Failed to fetch archives (status: ${res.status})`);
    } catch (err) {
      console.error(`Failed to fetch archives (attempt ${i + 1}/${retries}):`, err);
    }
    
    if (i < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return [];
}

export async function getArchiveContents(archiveName: string, retries = 5, delayMs = 1000): Promise<CachedImage[]> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${API_BASE}/archives/${encodeURIComponent(archiveName)}/contents`);
      if (res.ok) {
        return await res.json();
      }
      console.error(`Failed to fetch archive contents (status: ${res.status})`);
    } catch (err) {
      console.error(`Failed to fetch archive contents (attempt ${i + 1}/${retries}):`, err);
    }
    
    if (i < retries - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
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

export async function appendArchiveLog(archiveName: string, message: string): Promise<void> {
  const res = await fetch(`${API_BASE}/archives/${encodeURIComponent(archiveName)}/log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message })
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

import { getAllImageCaches, deleteImageCache } from './idb';

export async function migrateOldCachesToArchives(): Promise<void> {
  const isMigrated = localStorage.getItem('idb-to-archives-migrated');
  if (isMigrated === 'true') return;

  try {
    const oldCaches = await getAllImageCaches();
    if (oldCaches.length === 0) {
      localStorage.setItem('idb-to-archives-migrated', 'true');
      return;
    }

    console.log('Migrating old IndexedDB caches to Archives...');

    const folders = oldCaches.filter(c => c.type === 'folder');
    const images = oldCaches.filter(c => c.type === 'image' && c.blob);

    for (const folder of folders) {
      if (!folder.folderId) { // Root folder
        const childImages = images.filter(img => img.folderId === folder.key);
        if (childImages.length > 0) {
           // We need to make a valid ZIP name (remove invalid chars)
           const zipName = (folder.name || `Migrated_${Date.now()}`).replace(/[\\/:\*\?"<>\|]/g, '_');
           const filesToSave = childImages.map((img, idx) => ({
             blob: img.blob!,
             path: `${img.name || `image_${idx}`}.png`
           }));
           await saveArchive(zipName, filesToSave);
        }
        await deleteImageCache(folder.key);
        for (const img of childImages) {
           await deleteImageCache(img.key);
        }
      }
    }

    const remainingImages = await getAllImageCaches();
    const rootImages = remainingImages.filter(c => c.type === 'image' && c.blob && !c.folderId);
    
    for (const img of rootImages) {
      const zipName = (img.name || `Migrated_Image_${Date.now()}`).replace(/[\\/:\*\?"<>\|]/g, '_');
      await saveArchive(zipName, [{
        blob: img.blob!,
        path: `${img.name || 'image'}.png`
      }]);
      await deleteImageCache(img.key);
    }

    localStorage.setItem('idb-to-archives-migrated', 'true');
    console.log('Successfully migrated IDB caches to Archives');
    
    // Dispatch event so UI can refresh if open
    window.dispatchEvent(new CustomEvent('tool:cache-updated'));
  } catch (err) {
    console.error('Migration failed:', err);
  }
}
