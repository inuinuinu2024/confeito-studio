const DB_NAME = 'ConfeitoStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'PsdCache';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function setPsdCache(filename: string, fileHandle?: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    // Note: buffer is no longer saved
    const request = store.put({ filename, fileHandle }, 'lastPsd');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getPsdCache(): Promise<{ filename: string; fileHandle?: any } | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get('lastPsd');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export interface RecentFile {
  filename: string;
  fileHandle?: any;
  timestamp: number;
}

export async function addRecentFile(filename: string, fileHandle?: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const getReq = store.get('recentFiles');
    getReq.onsuccess = () => {
      let recents: RecentFile[] = getReq.result || [];
      recents = recents.filter(r => r.filename !== filename);
      recents.unshift({ filename, fileHandle, timestamp: Date.now() });
      recents = recents.slice(0, 10);
      const putReq = store.put(recents, 'recentFiles');
      putReq.onsuccess = () => {
        window.dispatchEvent(new Event('recent-files:updated'));
        resolve();
      };
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getRecentFiles(): Promise<RecentFile[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const getReq = store.get('recentFiles');
    getReq.onsuccess = () => resolve(getReq.result || []);
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function clearRecentFiles(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const putReq = store.put([], 'recentFiles');
    putReq.onsuccess = () => {
      window.dispatchEvent(new Event('recent-files:updated'));
      resolve();
    };
    putReq.onerror = () => reject(putReq.error);
  });
}

export interface CachedImage {
  key: string;
  name: string;
  timestamp: number;
  blob?: Blob;
  type?: 'image' | 'folder';
  folderId?: string | null;
  collapsed?: boolean;
}

export async function setImageCache(key: string, blob: Blob | undefined, name: string, type: 'image' | 'folder' = 'image', folderId: string | null = null, collapsed: boolean = false): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const data: any = { name, timestamp: Date.now(), type, folderId, collapsed };
    if (blob) data.blob = blob;
    const request = store.put(data, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getImageCache(key: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ? request.result.blob : null);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllImageCaches(): Promise<CachedImage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    const keysRequest = store.getAllKeys();
    
    request.onsuccess = () => {
      keysRequest.onsuccess = () => {
        const items: CachedImage[] = [];
        for (let i = 0; i < request.result.length; i++) {
          const key = keysRequest.result[i] as string;
          if (key && (key.startsWith('ToolResult_') || key.startsWith('ToolFolder_') || key.startsWith('ToolError_'))) {
            items.push({
              key,
              name: request.result[i].name || 'Unknown',
              timestamp: request.result[i].timestamp || 0,
              blob: request.result[i].blob,
              type: request.result[i].type || 'image',
              folderId: request.result[i].folderId || null,
              collapsed: request.result[i].collapsed || false
            });
          }
        }
        items.sort((a, b) => b.timestamp - a.timestamp);
        resolve(items);
      };
      keysRequest.onerror = () => reject(keysRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteImageCache(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function renameImageCache(key: string, newName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      const data = request.result;
      if (!data) return reject(new Error('Cache not found'));
      data.name = newName;
      const putReq = store.put(data, key);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function createCacheFolder(name: string): Promise<string> {
  const key = `ToolFolder_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  await setImageCache(key, undefined, name, 'folder', null);
  return key;
}

export async function moveCacheItem(key: string, folderId: string | null): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      const data = request.result;
      if (!data) return reject(new Error('Cache not found'));
      data.folderId = folderId;
      const putReq = store.put(data, key);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function updateCacheFolderCollapse(key: string, collapsed: boolean): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => {
      const data = request.result;
      if (!data) return reject(new Error('Cache not found'));
      data.collapsed = collapsed;
      const putReq = store.put(data, key);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    request.onerror = () => reject(request.error);
  });
}

