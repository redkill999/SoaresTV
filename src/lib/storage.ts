// Single-user local storage helpers
export type XtreamCreds = { server: string; username: string; password: string };
export type M3UPlaylist = { name: string; url: string; username?: string; password?: string };
export type FavItem = { type: "live" | "movie" | "series"; id: string; name: string; logo?: string };
export type HistItem = FavItem & { at: number; position?: number };
export type ParentalConfig = { pin: string | null; lockedCategories: string[] };

const K = {
  creds: "soarestv:creds",
  m3u: "soarestv:m3u",
  favs: "soarestv:favorites",
  hist: "soarestv:history",
  parental: "soarestv:parental",
};

const isBrowser = () => typeof window !== "undefined";

function read<T>(k: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write<T>(k: string, v: T) {
  if (!isBrowser()) return;
  localStorage.setItem(k, JSON.stringify(v));
  emit(k);
}

// --- Pub/sub for reactive reads -------------------------------------------
type Listener = () => void;
const subs: Record<string, Set<Listener>> = {};
function emit(k: string) {
  subs[k]?.forEach((fn) => fn());
}
function subscribe(k: string, fn: Listener) {
  (subs[k] ??= new Set()).add(fn);
  return () => {
    subs[k]?.delete(fn);
  };
}

// Cross-tab sync: when another tab writes localStorage, re-emit locally
if (isBrowser()) {
  window.addEventListener("storage", (e) => {
    if (e.key && subs[e.key]) emit(e.key);
  });
}

const sameItem = (a: FavItem, b: { type: FavItem["type"]; id: string }) =>
  a.type === b.type && a.id === b.id;

export const store = {
  getCreds: () => read<XtreamCreds | null>(K.creds, null),
  setCreds: (c: XtreamCreds | null) => write(K.creds, c),

  getM3U: () => read<M3UPlaylist[]>(K.m3u, []),
  setM3U: (l: M3UPlaylist[]) => write(K.m3u, l),

  getFavs: () => read<FavItem[]>(K.favs, []),
  toggleFav: (item: FavItem) => {
    const cur = read<FavItem[]>(K.favs, []);
    const exists = cur.some((x) => sameItem(x, item));
    const next = exists
      ? cur.filter((x) => !sameItem(x, item))
      : [{ ...item, id: String(item.id) }, ...cur];
    write(K.favs, next);
    return next;
  },
  isFav: (type: FavItem["type"], id: string | number) =>
    read<FavItem[]>(K.favs, []).some((x) => x.type === type && x.id === String(id)),
  subscribeFavs: (fn: Listener) => subscribe(K.favs, fn),

  getHistory: () => read<HistItem[]>(K.hist, []),
  pushHistory: (item: HistItem) => {
    const cur = read<HistItem[]>(K.hist, []).filter(
      (x) => !(x.type === item.type && x.id === item.id),
    );
    const next = [item, ...cur].slice(0, 100);
    write(K.hist, next);
  },
  clearHistory: () => write(K.hist, []),
  subscribeHistory: (fn: Listener) => subscribe(K.hist, fn),

  getParental: () => read<ParentalConfig>(K.parental, { pin: null, lockedCategories: [] }),
  setParental: (p: ParentalConfig) => write(K.parental, p),
};
