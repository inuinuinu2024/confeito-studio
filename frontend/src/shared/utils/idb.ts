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

export async function setDocumentCache(filename: string, fileHandle?: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ filename, fileHandle }, 'lastImage');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getDocumentCache(): Promise<{ filename: string; fileHandle?: any } | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get('lastImage');
    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function setPsdCache(filename: string, fileHandle?: any): Promise<void> {
  return setDocumentCache(filename, fileHandle);
}

export async function getPsdCache(): Promise<{ filename: string; fileHandle?: any } | null> {
  return getDocumentCache();
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

