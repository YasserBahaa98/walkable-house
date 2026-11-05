// Tiny IndexedDB wrapper. Projects can contain large reference drawings and
// imported 3D models, which would not fit in localStorage.

const DB_NAME = 'walkable-house';
const VERSION = 1;

export interface StoredModel { id: string; name: string; data: ArrayBuffer; createdAt: number; size?: { x: number; y: number; z: number } }

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open database'));
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? req.error ?? new Error('Database error'));
    t.onabort = () => reject(t.error ?? new Error('Database transaction aborted'));
  }));
}

export const kvGet = <T>(key: string) => tx<T | undefined>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const kvSet = (key: string, value: unknown) => tx('kv', 'readwrite', (s) => s.put(value, key)).then(() => undefined);

export const putModel = (m: StoredModel) => tx('models', 'readwrite', (s) => s.put(m)).then(() => undefined);
export const getModel = (id: string) => tx<StoredModel | undefined>('models', 'readonly', (s) => s.get(id) as IDBRequest<StoredModel | undefined>);
export const listModels = () => tx<StoredModel[]>('models', 'readonly', (s) => s.getAll() as IDBRequest<StoredModel[]>);
export const deleteModel = (id: string) => tx('models', 'readwrite', (s) => s.delete(id)).then(() => undefined);
