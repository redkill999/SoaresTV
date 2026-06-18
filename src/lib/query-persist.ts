// Lightweight persistent cache for React Query data. Lets heavy lists
// (movies/series catalogs) open instantly across reloads while still
// revalidating in background.
const PREFIX = "soarestv:qcache:";
const MAX_BYTES = 4_500_000; // ~4.5MB safety guard per entry

type Entry<T> = { t: number; v: T };

const isBrowser = () => typeof window !== "undefined";

export function loadPersisted<T>(key: string): { data: T; updatedAt: number } | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry<T>;
    if (!parsed || typeof parsed.t !== "number") return null;
    return { data: parsed.v, updatedAt: parsed.t };
  } catch {
    return null;
  }
}

export function savePersisted<T>(key: string, data: T) {
  if (!isBrowser()) return;
  try {
    const payload = JSON.stringify({ t: Date.now(), v: data } satisfies Entry<T>);
    if (payload.length > MAX_BYTES) return; // skip oversized payloads
    localStorage.setItem(PREFIX + key, payload);
  } catch {
    // quota exceeded or serialization failed — ignore
  }
}

export function clearPersisted(prefix?: string) {
  if (!isBrowser()) return;
  try {
    const full = PREFIX + (prefix ?? "");
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(full)) localStorage.removeItem(k);
    }
  } catch {
    // ignore
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
