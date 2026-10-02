/**
 * IndexedDB cache of the last saved/opened image file handle (File System Access API),
 * restored by DocumentManager on startup.
 */
const DB_NAME = 'ConfeitoStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'PsdCache'; // historical name, kept so existing caches still load
const LAST_IMAGE_KEY = 'lastImage';

export interface DocumentCacheEntry {
  filename: string;
  fileHandle?: FileSystemFileHandle | null;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setDocumentCache(filename: string, fileHandle?: FileSystemFileHandle | null): Promise<void> {
  await withStore('readwrite', store => store.put({ filename, fileHandle }, LAST_IMAGE_KEY));
}

export async function getDocumentCache(): Promise<DocumentCacheEntry | null> {
  return (await withStore<DocumentCacheEntry | undefined>('readonly', store => store.get(LAST_IMAGE_KEY))) ?? null;
}
