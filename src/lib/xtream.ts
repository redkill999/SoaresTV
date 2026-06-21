import { discoverPanelXtreamServer, xtreamApi, fetchM3U } from "./xtream.functions";
import type { XtreamCreds } from "./storage";
import { getUAHint, setUAHint } from "./ua-hint";

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

function hasWindowNativeBridge(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as typeof window & {
      Capacitor?: {
        isNativePlatform?: () => boolean;
        getPlatform?: () => string;
      };
    }
  ).Capacitor;
  const platform = cap?.getPlatform?.();
  return !!(cap?.isNativePlatform?.() || platform === "android" || platform === "ios");
}

function isAndroidWebViewShell(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /android/i.test(ua) &&
    (/\bwv\b/i.test(ua) || /version\/\d+(?:\.\d+)?.*chrome\/\d+.*mobile safari/i.test(ua))
  );
}

async function canUseNativeHttp(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (hasWindowNativeBridge()) return true;
  if (!isAndroidWebViewShell()) return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    const platform = Capacitor.getPlatform?.();
    return !!(
      Capacitor.isNativePlatform() ||
      platform === "android" ||
      platform === "ios"
    );
  } catch {
    return false;
  }
}

export async function isNativeApp(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (hasWindowNativeBridge() || isAndroidWebViewShell()) return true;
  try {
    const { Capacitor } = await import("@capacitor/core");
    const platform = Capacitor.getPlatform?.();
    return !!(
      Capacitor.isNativePlatform() ||
      platform === "android" ||
      platform === "ios"
    );
  } catch {
    return isAndroidWebViewShell();
  }
}

async function nativeHttpGet(
  url: string,
  timeoutMs = 12_000,
): Promise<NativeHttpResponse | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Capacitor, CapacitorHttp } = await import("@capacitor/core");
    const platform = Capacitor.getPlatform?.();
    const canUseHttp =
      Capacitor.isNativePlatform() ||
      platform === "android" ||
      platform === "ios" ||
      hasWindowNativeBridge();
    if (!canUseHttp) return null;
    return await CapacitorHttp.get({
      url,
      headers: IPTV_HEADERS,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha na conexão nativa Android: ${message}`);
  }
}

// Portas Xtream mais comuns. Antes eram 12 portas × 2 schemes = 24 candidatas
// (até ~240s no pior caso). Reduzido para 5 portas × 2 schemes = 10. Cobre
// >95% dos painéis sem castigar painéis lentos com waterfall enorme.
const COMMON_XTREAM_PORTS = ["", "80", "8080", "8880", "25461"] as const;

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

async function nativeApiWithFallbackPorts<T = unknown>(
  c: XtreamCreds,
  action?: string,
  params?: Record<string, string | number>,
): Promise<{ data: T; creds: XtreamCreds } | null> {
  if (!(await canUseNativeHttp())) return null;
  const base = normalizeServer(c.server);
  const candidates = new Set<string>([base]);
  try {
    const u = new URL(base);
    // Mantemos o origin original sempre como primeira tentativa.
    for (const scheme of ["http", "https"]) {
      for (const port of COMMON_XTREAM_PORTS) {
        candidates.add(`${scheme}://${u.hostname}${port ? `:${port}` : ""}`);
      }
    }
  } catch {
    // keep normalized base only
  }

  let lastError: unknown = null;
  let consecutiveFailures = 0;
  for (const server of candidates) {
    try {
      const data = await nativeApi<T>({ ...c, server }, action, params);
      if (data) return { data, creds: { ...c, server } };
      consecutiveFailures = 0;
    } catch (err) {
      lastError = err;
      consecutiveFailures += 1;
      // Fail-fast: 3 falhas seguidas significam servidor offline / DNS quebrado.
      // Sem isso, no pior caso esperaríamos timeoutMs × 10 candidatas = 120s.
      if (consecutiveFailures >= 3) break;
    }
  }
  if (lastError) throw lastError;
  return null;
}

export async function api<T = unknown>(
  c: XtreamCreds,
  action?: string,
  params?: Record<string, string | number>,
): Promise<T> {
  // Tenta direto pelo Android (CapacitorHttp). Se falhar no APK, NÃO
  // estouramos a UI — caímos para o proxy do server-fn, que tem rotação
  // de User-Agent e bypassa Cloudflare/bloqueios de UA do painel.
  try {
    const native = await nativeApiWithFallbackPorts<T>(c, action, params);
    if (native) return native.data;
  } catch {
    // segue para o fallback do server-fn
  }

  // Hint: UA que já funcionou para esse host — server-fn tenta esse primeiro.
  const preferredUA = getUAHint(c.server);
  const r = await xtreamApi({
    data: { ...c, action, params, preferredUA },
  });
  if (!r.ok) {
    const msg =
      "error" in r && typeof r.error === "string" ? r.error : "Resposta inválida do servidor";
    throw new Error(msg);
  }
  // Persistir UA vencedor para acelerar próxima chamada ao mesmo servidor.
  if ("ua" in r && typeof r.ua === "string") setUAHint(c.server, r.ua);
  return r.data as T;
}

export async function login(c: XtreamCreds) {
  // 1) Tenta autenticar pelo Android nativo (mesmo caminho do XCIPTV).
  let nativeRes: Awaited<
    ReturnType<
      typeof nativeApiWithFallbackPorts<{
        user_info?: { auth?: number | string; status?: string };
        server_info?: unknown;
      }>
    >
  > = null;
  try {
    nativeRes = await nativeApiWithFallbackPorts<{
      user_info?: { auth?: number | string; status?: string };
      server_info?: unknown;
    }>(c);
  } catch {
    // ignora — vamos cair pro server-fn abaixo
  }

  // 2) Se nativo não trouxe nada (web OU APK com painel bloqueando UA/IP),
  //    usa o proxy do server-fn — que rotaciona UAs estilo Xciptv/Smarters.
  const r =
    nativeRes?.data ??
    (await api<{ user_info?: { auth?: number | string; status?: string }; server_info?: unknown }>(
      c,
    ));
  const auth = r?.user_info?.auth;
  const ok = auth === 1 || auth === "1" || String(auth ?? "") === "1";
  if (!r?.user_info || !ok) throw new Error("Credenciais inválidas");
  if (nativeRes?.creds.server) c.server = nativeRes.creds.server;
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
  let target = (raw || "").trim();
  if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
  try {
    const u = new URL(target);
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
    `${normalizeServer(c.server)}/live/${c.username}/${c.password}/${id}.ts`,
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
      out.push({
        id: `m3u-${i++}`,
        url: line,
        name: cur.name || "Sem nome",
        logo: cur.logo,
        group: cur.group,
      });
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

async function nativeLoadM3U(
  url: string,
  username?: string,
  password?: string,
): Promise<M3UEntry[] | null> {
  if (!(await canUseNativeHttp())) return null;
  const first = buildClientM3UUrl(url, username, password);
  const candidates = new Set<string>([first]);
  try {
    const u = new URL(first);
    const user = u.searchParams.get("username") || username || "";
    const pass = u.searchParams.get("password") || password || "";
    if (
      user &&
      pass &&
      !u.pathname.toLowerCase().endsWith(".m3u") &&
      !u.pathname.toLowerCase().endsWith(".m3u8")
    ) {
      for (const scheme of ["http", "https"]) {
        for (const port of COMMON_XTREAM_PORTS) {
          for (const output of ["m3u8", "ts"]) {
            const out = new URL(`${scheme}://${u.hostname}${port ? `:${port}` : ""}/get.php`);
            out.searchParams.set("username", user);
            out.searchParams.set("password", pass);
            out.searchParams.set("type", "m3u_plus");
            out.searchParams.set("output", output);
            candidates.add(out.toString());
          }
        }
      }
    }
  } catch {
    // keep first URL only
  }

  let lastStatus = 0;
  let lastError: unknown = null;
  let consecutiveFailures = 0;
  for (const target of candidates) {
    try {
      const res = await nativeHttpGet(target, 15_000);
      if (!res) return null;
      lastStatus = res.status;
      if (res.status < 200 || res.status >= 300) { consecutiveFailures = 0; continue; }
      const text = typeof res.data === "string" ? res.data : String(res.data ?? "");
      const entries = parseM3U(text);
      if (entries.length) return entries;
      consecutiveFailures = 0;
    } catch (err) {
      lastError = err;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) break;
    }
  }
  if (lastStatus) throw new Error(`M3U respondeu HTTP ${lastStatus}`);
  if (lastError instanceof Error) throw lastError;
  throw new Error("Lista M3U vazia");
}

export async function loadM3U(
  url: string,
  username?: string,
  password?: string,
): Promise<M3UEntry[]> {
  // 1) Caminho nativo Android (igual ao XCIPTV).
  try {
    const native = await nativeLoadM3U(url, username, password);
    if (native && native.length) return native;
  } catch {
    // ignora — vamos cair pro proxy do server-fn
  }

  // 2) Fallback via server-fn (também usado pela web). No APK isso só
  //    é acionado quando o panel bloqueia a conexão direta do Android
  //    (Cloudflare/UA), garantindo que listas que rodam no XCIPTV
  //    também rodem aqui.
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
  const r = await api<{
    epg_listings?: Array<{
      id: string;
      title: string;
      description?: string;
      start_timestamp: string;
      stop_timestamp: string;
    }>;
  }>(c, "get_short_epg", { stream_id: streamId, limit });
  const list = r?.epg_listings ?? [];
  return list.map((e) => ({
    ...e,
    title: b64decode(e.title),
    description: e.description ? b64decode(e.description) : undefined,
  }));
}

/**
 * Full EPG (24h+) for a single channel — uses Xtream `get_simple_data_table`.
 * Each listing has start/stop in seconds (Unix epoch, as string).
 */
export async function getFullEpg(c: XtreamCreds, streamId: number | string): Promise<EpgListing[]> {
  const r = await api<{
    epg_listings?: Array<{
      id: string;
      title: string;
      description?: string;
      start_timestamp: string;
      stop_timestamp: string;
    }>;
  }>(c, "get_simple_data_table", { stream_id: streamId });
  const list = r?.epg_listings ?? [];
  return list.map((e) => ({
    ...e,
    title: b64decode(e.title),
    description: e.description ? b64decode(e.description) : undefined,
  }));
}
