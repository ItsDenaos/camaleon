/**
 * Local capture library in IndexedDB. Two stores so listing stays cheap:
 *  - `captures`: metadata + small thumbnail (read in bulk for the grid)
 *  - `blobs`:    the full file, read only when opened/downloaded/shared
 * If IndexedDB is unavailable (some private modes) everything falls back to memory
 * for the current session.
 */

export type CaptureKind = 'photo' | 'strip' | 'gif' | 'boomerang' | 'video';

export interface CaptureMeta {
  id: string;
  kind: CaptureKind;
  mime: string;
  width: number;
  height: number;
  /** Seconds, for videos. */
  duration?: number;
  /** File size in bytes. */
  size: number;
  createdAt: number;
  /** Effect names applied at capture time. */
  effects: string[];
  thumb: Blob;
}

export type NewCapture = Omit<CaptureMeta, 'id' | 'createdAt' | 'size'>;

const DB_NAME = 'camaleon';
const DB_VERSION = 2;
const META = 'captures';
const BLOBS = 'blobs';
/** v2: user-picked images for effects (e.g. custom backgrounds), keyed `${effectId}/${key}`. */
const ASSETS = 'assets';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memMeta = new Map<string, CaptureMeta>();
const memBlobs = new Map<string, Blob>();
const memAssets = new Map<string, Blob>();

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
        if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** True when captures survive a reload (IndexedDB works). */
export async function isPersistent(): Promise<boolean> {
  return (await open()) !== null;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let persistRequested = false;

export async function saveCapture(capture: NewCapture, blob: Blob): Promise<CaptureMeta> {
  const meta: CaptureMeta = {
    ...capture,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    size: blob.size,
  };
  const db = await open();
  if (!db) {
    memMeta.set(meta.id, meta);
    memBlobs.set(meta.id, blob);
    return meta;
  }
  // Ask once to be exempt from storage eviction; harmless if refused.
  if (!persistRequested) {
    persistRequested = true;
    void navigator.storage?.persist?.().catch(() => false);
  }
  const tx = db.transaction([META, BLOBS], 'readwrite');
  tx.objectStore(BLOBS).put(blob, meta.id);
  tx.objectStore(META).put(meta);
  await done(tx);
  return meta;
}

/** All captures, newest first. */
export async function listCaptures(): Promise<CaptureMeta[]> {
  const db = await open();
  const all = db
    ? await request(db.transaction(META).objectStore(META).getAll() as IDBRequest<CaptureMeta[]>)
    : [...memMeta.values()];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getCaptureBlob(id: string): Promise<Blob | undefined> {
  const db = await open();
  if (!db) return memBlobs.get(id);
  return request(db.transaction(BLOBS).objectStore(BLOBS).get(id) as IDBRequest<Blob | undefined>);
}

export async function deleteCapture(id: string): Promise<void> {
  const db = await open();
  if (!db) {
    memMeta.delete(id);
    memBlobs.delete(id);
    return;
  }
  const tx = db.transaction([META, BLOBS], 'readwrite');
  tx.objectStore(META).delete(id);
  tx.objectStore(BLOBS).delete(id);
  await done(tx);
}

export async function deleteAllCaptures(): Promise<void> {
  const db = await open();
  memMeta.clear();
  memBlobs.clear();
  if (!db) return;
  const tx = db.transaction([META, BLOBS], 'readwrite');
  tx.objectStore(META).clear();
  tx.objectStore(BLOBS).clear();
  await done(tx);
}

/** Bytes used by this origin, when the browser tells us. */
export async function storageUsed(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Effect assets (user images)
// ---------------------------------------------------------------------------

export async function putAsset(key: string, blob: Blob | null): Promise<void> {
  const db = await open();
  if (!db) {
    if (blob) memAssets.set(key, blob);
    else memAssets.delete(key);
    return;
  }
  const tx = db.transaction(ASSETS, 'readwrite');
  if (blob) tx.objectStore(ASSETS).put(blob, key);
  else tx.objectStore(ASSETS).delete(key);
  await done(tx);
}

export async function listAssets(): Promise<[string, Blob][]> {
  const db = await open();
  if (!db) return [...memAssets];
  const store = db.transaction(ASSETS).objectStore(ASSETS);
  const [keys, values] = await Promise.all([
    request(store.getAllKeys() as IDBRequest<string[]>),
    request(store.getAll() as IDBRequest<Blob[]>),
  ]);
  return keys.map((k, i) => [k, values[i]]);
}
