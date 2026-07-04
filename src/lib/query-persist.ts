// Persistent cache for React Query data backed by IndexedDB.
// Keeps the API synchronous via an in-memory Map (hydrated from IDB at boot)
// so heavy lists (movies/series catalogs) open instantly across reloads
// while still revalidating in background. Falls back to localStorage when
// IndexedDB is not available (older webviews, private mode).

const DB_NAME = "soarestv";
const STORE = "qcache";
const LS_PREFIX = "soarestv:qcache:";

type Entry<T> = { t: number; v: T };

const isBrowser = () => typeof window !== "undefined";
const memory = new Map<string, Entry<unknown>>();
let hydrated = false;
let hydratingPromise: Promise<void> | null = null;

// ---------- IndexedDB helpers ----------
function openDB(): Promise<IDBDatabase | null> {
  if (!isBrowser() || typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGetAll(): Promise<Array<{ key: string; entry: Entry<unknown> }>> {
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const out: Array<{ key: string; entry: Entry<unknown> }> = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const entry = cursor.value as Entry<unknown>;
          if (entry && typeof entry.t === "number" && entry.t > 0) {
            out.push({ key: String(cursor.key), entry });
          }
          cursor.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve([]);
    }
  });
}

async function idbPut(key: string, entry: Entry<unknown>): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbClear(prefix?: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (!prefix) {
        store.clear();
      } else {
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            if (String(cursor.key).startsWith(prefix)) cursor.delete();
            cursor.continue();
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

// ---------- localStorage fallback (read-only legacy migration) ----------
function lsLoadLegacy(): Array<{ key: string; entry: Entry<unknown> }> {
  if (!isBrowser()) return [];
  const out: Array<{ key: string; entry: Entry<unknown> }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LS_PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as Entry<unknown>;
        if (parsed && typeof parsed.t === "number" && parsed.t > 0) {
          out.push({ key: k.slice(LS_PREFIX.length), entry: parsed });
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

// ---------- Public API ----------
export function hydratePersistedCache(): Promise<void> {
  if (!isBrowser()) return Promise.resolve();
  if (hydrated) return Promise.resolve();
  if (hydratingPromise) return hydratingPromise;
  hydratingPromise = (async () => {
    try {
      // Migrate any legacy localStorage entries into memory + IDB then purge.
      const legacy = lsLoadLegacy();
      for (const { key, entry } of legacy) memory.set(key, entry);
      const fromIdb = await idbGetAll();
      for (const { key, entry } of fromIdb) {
        // Prefer freshest version between sources
        const prev = memory.get(key);
        if (!prev || entry.t > prev.t) memory.set(key, entry);
      }
      // Best-effort: push migrated legacy entries into IDB and clear LS.
      if (legacy.length) {
        await Promise.all(legacy.map(({ key, entry }) => idbPut(key, entry)));
        try {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
          }
        } catch {
          /* ignore */
        }
      }
      hydrated = true;
    } catch {
      hydrated = true;
    }
  })();
  return hydratingPromise;
}

export function loadPersisted<T>(key: string): { data: T; updatedAt: number } | null {
  const entry = memory.get(key) as Entry<T> | undefined;
  if (!entry) return null;
  return { data: entry.v, updatedAt: entry.t };
}

export function savePersisted<T>(key: string, data: T) {
  const entry: Entry<T> = { t: Date.now(), v: data };
  memory.set(key, entry);
  // Fire-and-forget IDB write
  void idbPut(key, entry);
}

export function clearPersisted(prefix?: string) {
  if (!prefix) memory.clear();
  else {
    for (const k of Array.from(memory.keys())) {
      if (k.startsWith(prefix)) memory.delete(k);
    }
  }
  void idbClear(prefix);
  // Also clear legacy LS entries
  if (isBrowser()) {
    try {
      const full = LS_PREFIX + (prefix ?? "");
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(full)) localStorage.removeItem(k);
      }
    } catch {
      /* ignore */
    }
  }
}

/** Wraps a queryFn so its result is persisted on success. */
export function withPersist<T>(key: string, fn: () => Promise<T>): () => Promise<T> {
  return async () => {
    const data = await fn();
    savePersisted(key, data);
    return data;
  };
}
