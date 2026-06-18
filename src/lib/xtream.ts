import { discoverPanelXtreamServer, xtreamApi, fetchM3U } from "./xtream.functions";
import type { XtreamCreds } from "./storage";

export type LiveCategory = { category_id: string; category_name: string };
export type LiveStream = {
  num: number;
  name: string;
  stream_id: number;
  stream_icon: string;
  category_id: string;
  epg_channel_id?: string;
};
export type VodStream = {
  num: number;
  name: string;
  stream_id: number;
  stream_icon: string;
  category_id: string;
  container_extension: string;
  rating?: string;
};
export type Series = {
  num: number;
  name: string;
  series_id: number;
  cover: string;
  category_id: string;
  plot?: string;
  releaseDate?: string;
};
export type Episode = {
  id: string;
  episode_num: number;
  title: string;
  container_extension: string;
  info?: { plot?: string; movie_image?: string; duration?: string };
};

const IPTV_HEADERS = {
  "User-Agent": "XCIPTV/6.0 (Linux; Android 11) okhttp/4.9.3",
  Accept: "*/*",
  "Accept-Encoding": "identity",
};

type NativeHttpResponse = { status: number; data: unknown };

async function nativeHttpGet(url: string): Promise<NativeHttpResponse | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Capacitor, CapacitorHttp } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
    return await CapacitorHttp.get({
      url,
      headers: IPTV_HEADERS,
      connectTimeout: 20_000,
      readTimeout: 20_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha na conexão nativa Android: ${message}`);
  }
}

function parseNativeJson(data: unknown) {
  if (typeof data === "string") return JSON.parse(data);
  return data;
}

async function nativeApi<T = unknown>(
  c: XtreamCreds,
  action?: string,
  params?: Record<string, string | number>,
): Promise<T | null> {
  const url = new URL(`${normalizeServer(c.server)}/player_api.php`);
  url.searchParams.set("username", c.username);
  url.searchParams.set("password", c.password);
  if (action) url.searchParams.set("action", action);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  }

  const res = await nativeHttpGet(url.toString());
  if (!res) return null;
  if (res.status < 200 || res.status >= 300) throw new Error(`Xtream respondeu HTTP ${res.status}`);
  return parseNativeJson(res.data) as T;
}

export async function api<T = unknown>(
  c: XtreamCreds,
  action?: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const native = await nativeApi<T>(c, action, params);
  if (native) return native;

  const r = await xtreamApi({ data: { ...c, action, params } });
  if (!r.ok) throw new Error("Resposta inválida do servidor");
  return r.data as T;
}

export async function login(c: XtreamCreds) {
  const r = await api<{ user_info?: { auth?: number | string; status?: string }; server_info?: unknown }>(
    c,
  );
  const auth = r?.user_info?.auth;
  const ok = auth === 1 || auth === "1" || String(auth ?? "") === "1";
  if (!r?.user_info || !ok) throw new Error("Credenciais inválidas");
  return r;
}

export async function discoverPanelServer(c: XtreamCreds) {
  return discoverPanelXtreamServer({ data: c });
}

export const normalizeServer = (s: string) => {
  let v = s.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  try {
    const u = new URL(v);
    return u.origin;
  } catch {
    return v;
  }
};

export function xtreamCredsFromUrl(
  raw: string,
  username?: string,
  password?: string,
): XtreamCreds | null {
  const normalized = normalizeServer(raw || "");
  try {
    const u = new URL(normalized);
    const user = u.searchParams.get("username") || username || "";
    const pass = u.searchParams.get("password") || password || "";
    if (!user || !pass) return null;
    return { server: u.origin, username: user, password: pass };
  } catch {
    return null;
  }
}

export const streamUrl = {
  live: (c: XtreamCreds, id: number | string) =>
    `${normalizeServer(c.server)}/live/${c.username}/${c.password}/${id}.m3u8`,
  movie: (c: XtreamCreds, id: number | string, ext = "mp4") =>
    `${normalizeServer(c.server)}/movie/${c.username}/${c.password}/${id}.${ext}`,
  episode: (c: XtreamCreds, id: number | string, ext = "mp4") =>
    `${normalizeServer(c.server)}/series/${c.username}/${c.password}/${id}.${ext}`,
};

// --- M3U parser ---
export type M3UEntry = {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
};

export function parseM3U(text: string): M3UEntry[] {
  const lines = text.split(/\r?\n/);
  const out: M3UEntry[] = [];
  let cur: Partial<M3UEntry> | null = null;
  let i = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF")) {
      const name = line.split(",").slice(1).join(",").trim();
      const logo = /tvg-logo="([^"]+)"/.exec(line)?.[1];
      const group = /group-title="([^"]+)"/.exec(line)?.[1];
      cur = { name, logo, group };
    } else if (line && !line.startsWith("#") && cur) {
      out.push({ id: `m3u-${i++}`, url: line, name: cur.name || "Sem nome", logo: cur.logo, group: cur.group });
      cur = null;
    }
  }
  return out;
}

function buildClientM3UUrl(raw: string, username?: string, password?: string): string {
  let target = (raw || "").trim();
  if (!target) throw new Error("URL vazia");
  if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
  const u = new URL(target);
  const path = u.pathname.toLowerCase();

  if (path.endsWith("/get.php")) {
    if (username && !u.searchParams.get("username")) u.searchParams.set("username", username);
    if (password && !u.searchParams.get("password")) u.searchParams.set("password", password);
    if (!u.searchParams.get("type")) u.searchParams.set("type", "m3u_plus");
    if (!u.searchParams.get("output")) u.searchParams.set("output", "m3u8");
    return u.toString();
  }

  if (path === "/" || path === "" || path.endsWith("/player_api.php")) {
    const user = u.searchParams.get("username") || username || "";
    const pass = u.searchParams.get("password") || password || "";
    if (!user || !pass) throw new Error("Para URLs Xtream informe usuário e senha");
    const out = new URL(`${u.origin}/get.php`);
    out.searchParams.set("username", user);
    out.searchParams.set("password", pass);
    out.searchParams.set("type", "m3u_plus");
    out.searchParams.set("output", "m3u8");
    return out.toString();
  }

  return target;
}

async function nativeLoadM3U(url: string, username?: string, password?: string): Promise<M3UEntry[] | null> {
  const target = buildClientM3UUrl(url, username, password);
  const res = await nativeHttpGet(target);
  if (!res) return null;
  if (res.status < 200 || res.status >= 300) throw new Error(`M3U respondeu HTTP ${res.status}`);
  const text = typeof res.data === "string" ? res.data : String(res.data ?? "");
  return parseM3U(text);
}

export async function loadM3U(
  url: string,
  username?: string,
  password?: string,
): Promise<M3UEntry[]> {
  const native = await nativeLoadM3U(url, username, password);
  if (native) return native;

  const r = await fetchM3U({ data: { url, username, password } });
  if (r.error) throw new Error(r.error);
  return r.entries as M3UEntry[];
}

// --- EPG ---
export type EpgListing = {
  id: string;
  title: string;
  description?: string;
  start_timestamp: string;
  stop_timestamp: string;
};

function b64decode(s: string): string {
  try {
    if (typeof atob !== "undefined") return decodeURIComponent(escape(atob(s)));
    // node fallback
    return Buffer.from(s, "base64").toString("utf-8");
  } catch {
    return s;
  }
}

export async function getShortEpg(c: XtreamCreds, streamId: number | string, limit = 4) {
  const r = await api<{ epg_listings?: Array<{ id: string; title: string; description?: string; start_timestamp: string; stop_timestamp: string }> }>(
    c,
    "get_short_epg",
    { stream_id: streamId, limit },
  );
  const list = r?.epg_listings ?? [];
  return list.map((e) => ({
    ...e,
    title: b64decode(e.title),
    description: e.description ? b64decode(e.description) : undefined,
  }));
}
