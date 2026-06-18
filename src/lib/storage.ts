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
}

export const store = {
  getCreds: () => read<XtreamCreds | null>(K.creds, null),
  setCreds: (c: XtreamCreds | null) => write(K.creds, c),

  getM3U: () => read<M3UPlaylist[]>(K.m3u, []),
  setM3U: (l: M3UPlaylist[]) => write(K.m3u, l),

  getFavs: () => read<FavItem[]>(K.favs, []),
  toggleFav: (item: FavItem) => {
    const cur = read<FavItem[]>(K.favs, []);
    const i = cur.findIndex((x) => x.type === item.type && x.id === item.id);
    const next = i >= 0 ? cur.filter((_, idx) => idx !== i) : [item, ...cur];
    write(K.favs, next);
    return next;
  },
  isFav: (type: FavItem["type"], id: string) =>
    read<FavItem[]>(K.favs, []).some((x) => x.type === type && x.id === id),

  getHistory: () => read<HistItem[]>(K.hist, []),
  pushHistory: (item: HistItem) => {
    const cur = read<HistItem[]>(K.hist, []).filter(
      (x) => !(x.type === item.type && x.id === item.id),
    );
    const next = [item, ...cur].slice(0, 100);
    write(K.hist, next);
  },
  clearHistory: () => write(K.hist, []),

  getParental: () => read<ParentalConfig>(K.parental, { pin: null, lockedCategories: [] }),
  setParental: (p: ParentalConfig) => write(K.parental, p),
};
