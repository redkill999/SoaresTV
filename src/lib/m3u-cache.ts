import type { M3UEntry } from "./xtream";

// Persistent M3U cache.
// - In-memory layer: instant, survives client-side navigation (used by the
//   login → playlist hand-off, where re-reading IDB would add latency).
// - IndexedDB layer: survives full reloads and app restarts. Keyed by playlist
//   URL so multiple lists coexist. Stored as the raw parsed entries array
//   (large lists would blow the 5 MB localStorage quota).
//
// API stays sync-compatible with the previous in-memory-only cache; persistence
// is opt-in via loadPersisted(url) on mount.

type Cached = { url: string; name: string; entries: M3UEntry[]; at: number };

const DB_NAME = "soarestv";
// v2: invalida cache antigo gerado com output=m3u8 que produzia URLs LIVE 404
// em painéis sem variante HLS (ex.: flipex.pro). O nome "m3u" antigo continua
// no DB mas é ignorado — a próxima escrita popula "m3u_v2".
const STORE = "m3u_v2";
const TTL_MS = 12 * 60 * 60 * 1000; // 12h — refresh in background after that
const STALE_MS = 2 * 60 * 60 * 1000; // 2h — UI shows cached but revalidates

let memory: Cached | null = null;

function idb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet(key: string): Promise<Cached | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Cached) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(key: string, value: Cached): Promise<void> {
  const db = await idb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDelete(key?: string): Promise<void> {
  const db = await idb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (key) store.delete(key);
      else store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export const m3uCache = {
  /** Snapshot in-memory (sync). */
  get(): { url: string; name: string; entries: M3UEntry[] } | null {
    return memory;
  },

  /** Idade do cache em memória, em ms. `null` se vazio. */
  age(): number | null {
    return memory ? Date.now() - memory.at : null;
  },

  /** Acima de STALE_MS sugere refresh em background. */
  isStale(): boolean {
    const a = m3uCache.age();
    return a == null ? true : a > STALE_MS;
  },

  /** Atualiza memória + persiste em IDB. */
  set(url: string, name: string, entries: M3UEntry[]) {
    memory = { url, name, entries, at: Date.now() };
    // fire-and-forget — não bloqueia a UI
    void idbSet(url, memory);
  },

  /**
   * Hidrata memória a partir do IDB se houver entrada válida (não expirada).
   * Retorna `true` se hidratou. Não sobrescreve memória mais recente.
   */
  async loadPersisted(url: string): Promise<boolean> {
    if (!url) return false;
    if (memory?.url === url) return true;
    const hit = await idbGet(url);
    if (!hit) return false;
    if (Date.now() - hit.at > TTL_MS) {
      void idbDelete(url);
      return false;
    }
    memory = hit;
    return true;
  },

  /** Limpa memória e (opcionalmente) uma URL específica do IDB; sem URL limpa tudo. */
  clear(url?: string) {
    memory = null;
    void idbDelete(url);
  },
};
