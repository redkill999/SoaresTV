// Single-user local storage helpers

// In-memory store for floating mini player (não persistir em localStorage).
export type MiniPlayerState = { streamId: string; name: string; logo?: string; src?: string } | null;
let _miniPlayer: MiniPlayerState = null;
const _miniListeners = new Set<() => void>();
export const miniPlayerStore = {
  get: (): MiniPlayerState => _miniPlayer,
  set: (v: MiniPlayerState) => {
    _miniPlayer = v;
    _miniListeners.forEach((fn) => fn());
  },
  subscribe: (fn: () => void) => {
    _miniListeners.add(fn);
    return () => {
      _miniListeners.delete(fn);
    };
  },
};

// In-memory store para abrir a busca global de qualquer lugar (AppShell, atalho).
let _globalSearchOpen = false;
const _gsListeners = new Set<() => void>();
export const globalSearchStore = {
  get: (): boolean => _globalSearchOpen,
  set: (v: boolean) => {
    if (_globalSearchOpen === v) return;
    _globalSearchOpen = v;
    _gsListeners.forEach((fn) => fn());
  },
  subscribe: (fn: () => void) => {
    _gsListeners.add(fn);
    return () => { _gsListeners.delete(fn); };
  },
};

// Compatibilidade por lista/servidor: opções que sobrescrevem o comportamento
// padrão do player para uma origem específica.
export type ListUserAgent =
  | "auto" | "xciptv" | "smarters" | "tivimate" | "vlc" | "okhttp" | "lavf" | "chrome";
export type ListTransport = "auto" | "proxy" | "direct";
export type ListStreamFormat = "auto" | "hls" | "ts" | "mp4";
export type ListCompat = {
  userAgent?: ListUserAgent;        // default "auto"
  streamFormat?: ListStreamFormat;  // default "auto"
  transport?: ListTransport;        // default "auto"
  forceHttps?: boolean;             // upgrade http->https antes de tudo
};

export type XtreamCreds = { server: string; username: string; password: string; compat?: ListCompat };
export type M3UPlaylist = { name: string; url: string; username?: string; password?: string; mode?: "playlist" | "xtream"; compat?: ListCompat };
export type FavItem = { type: "live" | "movie" | "series"; id: string; name: string; logo?: string };
export type HistItem = FavItem & { at: number; position?: number; duration?: number };

/** Mapeia o User-Agent escolhido para a string real enviada ao provedor. */
export const USER_AGENT_STRINGS: Record<Exclude<ListUserAgent, "auto">, string> = {
  xciptv:   "XCIPTV/6.0 (Linux; Android 11) okhttp/4.9.3",
  smarters: "IPTVSmartersPro/3.1.5",
  tivimate: "TiviMate/4.7.0",
  vlc:      "VLC/3.0.20 LibVLC/3.0.20",
  okhttp:   "okhttp/4.9.3",
  lavf:     "Lavf/58.76.100",
  chrome:   "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

/** Resolve as opções de compatibilidade aplicáveis a uma URL de stream,
 *  comparando o host com as credenciais Xtream e as listas M3U salvas. */
export function getCompatForUrl(url: string): ListCompat {
  if (!isBrowser()) return {};
  let host = "";
  try { host = new URL(url).host.toLowerCase(); } catch { return {}; }
  if (!host) return {};
  try {
    const creds = read<XtreamCreds | null>(K.creds, null);
    if (creds?.server) {
      try {
        const ch = new URL(creds.server).host.toLowerCase();
        if (ch && ch === host && creds.compat) return creds.compat;
      } catch { /* noop */ }
    }
    const lists = read<M3UPlaylist[]>(K.m3u, []);
    for (const l of lists) {
      try {
        const lh = new URL(l.url).host.toLowerCase();
        if (lh && lh === host && l.compat) return l.compat;
      } catch { /* noop */ }
    }
  } catch { /* noop */ }
  return {};
}
export type ParentalConfig = { pin: string | null; lockedCategories: string[] };
export type AspectRatio = "default" | "16:9" | "4:3" | "fill" | "stretch";
export type StreamFormat = "auto" | "hls" | "ts" | "mp4";
export type PlayerChoice = "internal" | "external" | "vlc" | "exo";
export type PlayerEngine = "exo" | "vlc";
export type CategoryPlayers = {
  live: PlayerEngine;
  vod: PlayerEngine;
  series: PlayerEngine;
  catchup: PlayerEngine;
  multiscreen: PlayerEngine;
};
export type RemoteLayout = "default" | "compact" | "tv";
export type AppSettings = {
  defaultPlayer: PlayerChoice;
  streamFormat: StreamFormat;
  hwAccel: boolean;
  aspectRatio: AspectRatio;
  subtitleScale: number; // 0.75 .. 2
  autoplayNext: boolean;
  epgOffsetMin: number; // -720..720
  remoteLayout: RemoteLayout;
  showHidden: boolean;
  categoryPlayers: CategoryPlayers;
};
const DEFAULT_APP_SETTINGS: AppSettings = {
  defaultPlayer: "internal",
  streamFormat: "auto",
  hwAccel: true,
  aspectRatio: "default",
  subtitleScale: 1,
  autoplayNext: true,
  epgOffsetMin: 0,
  remoteLayout: "default",
  showHidden: false,
  categoryPlayers: { live: "exo", vod: "exo", series: "exo", catchup: "exo", multiscreen: "exo" },
};

const K = {
  creds: "soarestv:creds",
  m3u: "soarestv:m3u",
  favs: "soarestv:favorites",
  hist: "soarestv:history",
  parental: "soarestv:parental",
  appSettings: "soarestv:appSettings",
  lastEp: "soarestv:lastEpisode",
};

const isBrowser = () => typeof window !== "undefined";

// Cached parsed snapshots so identical reads return the same reference
// (required by useSyncExternalStore to avoid render loops).
const snapshots: Record<string, { raw: string | null; value: unknown }> = {};

function read<T>(k: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = localStorage.getItem(k);
    const cached = snapshots[k];
    if (cached && cached.raw === raw) return cached.value as T;
    if (!raw) {
      snapshots[k] = { raw, value: fallback };
      return fallback;
    }
    const parsed = JSON.parse(raw) as T;
    // Defensivo: se o fallback é array mas o parsed não é (corrupção / mudança
    // de formato em versão antiga), devolve fallback em vez de quebrar caller
    // que faria .filter/.some/.map. Não apaga o registro — usuário pode
    // recuperar manualmente; só evita crash silencioso.
    if (Array.isArray(fallback) && !Array.isArray(parsed)) {
      snapshots[k] = { raw, value: fallback };
      return fallback;
    }
    snapshots[k] = { raw, value: parsed };
    return parsed;
  } catch {
    return fallback;
  }
}
// Avisos de quota são "throttled" por chave — uma lista cheia pode disparar
// dezenas de writes seguidos e não queremos floodar o console nem virar
// fonte de jank no APK.
const lastQuotaWarn: Record<string, number> = {};
function warnQuota(k: string, err: unknown) {
  const now = Date.now();
  if (now - (lastQuotaWarn[k] ?? 0) < 30_000) return;
  lastQuotaWarn[k] = now;
  const name = err instanceof Error ? err.name : "Error";
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[storage] write falhou em "${k}" (${name}): ${msg}`);
}
function write<T>(k: string, v: T) {
  if (!isBrowser()) return;
  try {
    const raw = JSON.stringify(v);
    localStorage.setItem(k, raw);
    snapshots[k] = { raw, value: v };
    emit(k);
  } catch (err) {
    // Quota exceeded ou serialização falhou — não derruba o app, mas avisa.
    warnQuota(k, err);
  }
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
    const set = subs[k];
    if (!set) return;
    set.delete(fn);
    // Libera o Set quando esvazia — evita acumular chaves com Sets vazios
    // após muitos mount/unmount em rotas que assinam favoritos/history.
    if (set.size === 0) delete subs[k];
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
    const now = Date.now();
    const TTL = 60 * 24 * 60 * 60 * 1000; // 60 dias
    const MAX = 200;
    const cur = read<HistItem[]>(K.hist, []).filter(
      (x) => !(x.type === item.type && x.id === item.id) && (now - x.at) < TTL,
    );
    const next = [item, ...cur].slice(0, MAX);
    write(K.hist, next);
  },
  /** Atualiza posição/duração do item mais recente sem reordenar o histórico.
   *  Throttle: ignora se a última gravação foi há <4s E a posição mudou <5s
   *  — evita 12 writes/min do tick do player saturando localStorage no APK. */
  updateProgress: (type: HistItem["type"], id: string, position: number, duration: number) => {
    const cur = read<HistItem[]>(K.hist, []);
    const idx = cur.findIndex((x) => x.type === type && x.id === id);
    if (idx === -1) return;
    const prev = cur[idx];
    const now = Date.now();
    const sincePrev = now - prev.at;
    const posDelta = Math.abs((prev.position ?? 0) - position);
    if (sincePrev < 4000 && posDelta < 5) return;
    const next = cur.slice();
    next[idx] = { ...prev, position, duration, at: now };
    write(K.hist, next);
  },
  removeHistory: (type: HistItem["type"], id: string) => {
    const cur = read<HistItem[]>(K.hist, []);
    write(K.hist, cur.filter((x) => !(x.type === type && x.id === id)));
  },
  getHistoryItem: (type: HistItem["type"], id: string) =>
    read<HistItem[]>(K.hist, []).find((x) => x.type === type && x.id === id) ?? null,
  clearHistory: () => write(K.hist, []),
  subscribeHistory: (fn: Listener) => subscribe(K.hist, fn),

  getParental: () => read<ParentalConfig>(K.parental, { pin: null, lockedCategories: [] }),
  setParental: (p: ParentalConfig) => write(K.parental, p),

  getAppSettings: () => ({ ...DEFAULT_APP_SETTINGS, ...read<Partial<AppSettings>>(K.appSettings, {}) }),
  setAppSettings: (patch: Partial<AppSettings>) => {
    const cur = { ...DEFAULT_APP_SETTINGS, ...read<Partial<AppSettings>>(K.appSettings, {}) };
    write(K.appSettings, { ...cur, ...patch });
  },
  subscribeAppSettings: (fn: Listener) => subscribe(K.appSettings, fn),

  /** Último episódio assistido por série (id da série -> id do episódio). */
  getLastEpisode: (seriesId: string): string | null => {
    const map = read<Record<string, string>>(K.lastEp, {});
    return map[seriesId] ?? null;
  },
  setLastEpisode: (seriesId: string, episodeId: string) => {
    const map = read<Record<string, string>>(K.lastEp, {});
    if (map[seriesId] === episodeId) return;
    write(K.lastEp, { ...map, [seriesId]: episodeId });
  },
};
