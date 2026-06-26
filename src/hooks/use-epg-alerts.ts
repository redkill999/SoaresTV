import { useSyncExternalStore, useEffect } from "react";

export type EpgAlert = {
  streamId: string;
  programTitle: string;
  startTimestamp: number;
};

const STORAGE_KEY = "soarestv:epg-alerts";

function read(): EpgAlert[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a) =>
        a &&
        typeof a.streamId === "string" &&
        typeof a.programTitle === "string" &&
        typeof a.startTimestamp === "number",
    );
  } catch {
    return [];
  }
}

function write(list: EpgAlert[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota */
  }
}

const subscribers = new Set<() => void>();
let cache: EpgAlert[] = read();

function emit() {
  for (const fn of subscribers) fn();
}

function setList(next: EpgAlert[]) {
  cache = next;
  write(next);
  emit();
}

export const epgAlertsStore = {
  get: () => cache,
  subscribe: (fn: () => void) => {
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  },
  add: (item: EpgAlert) => {
    if (cache.some((a) => a.startTimestamp === item.startTimestamp && a.streamId === item.streamId)) return;
    setList([...cache, item]);
  },
  remove: (startTimestamp: number) => {
    setList(cache.filter((a) => a.startTimestamp !== startTimestamp));
  },
  has: (startTimestamp: number) =>
    cache.some((a) => a.startTimestamp === startTimestamp),
};

// Cross-tab sync
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      cache = read();
      emit();
    }
  });
}

const serverSnapshot: EpgAlert[] = [];
const getServer = () => serverSnapshot;

export function useEpgAlerts() {
  const alerts = useSyncExternalStore(epgAlertsStore.subscribe, epgAlertsStore.get, getServer);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    // Best-effort permission request on mount if still default
    if (Notification.permission === "default") {
      try {
        Notification.requestPermission().catch(() => {});
      } catch {
        /* some browsers throw on insecure contexts */
      }
    }

    const tick = () => {
      if (typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      const now = Math.floor(Date.now() / 1000);
      const due = epgAlertsStore.get().filter(
        (a) => a.startTimestamp >= now && a.startTimestamp <= now + 60,
      );
      if (due.length === 0) return;
      for (const a of due) {
        try {
          new Notification("Vai começar agora", {
            body: a.programTitle,
            tag: `epg-${a.startTimestamp}-${a.streamId}`,
          });
        } catch {
          /* notification creation can throw on some platforms */
        }
        epgAlertsStore.remove(a.startTimestamp);
      }
    };

    const id = setInterval(tick, 30_000);
    tick();
    return () => clearInterval(id);
  }, []);

  return {
    alerts,
    addAlert: epgAlertsStore.add,
    removeAlert: epgAlertsStore.remove,
    hasAlert: epgAlertsStore.has,
  };
}
