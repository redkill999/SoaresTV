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

// UAs alternativos tentados no caminho nativo (APK) quando o painel
// rejeita o UA padrão com 401/403. Cobre painéis que filtram por UA.
const NATIVE_FALLBACK_UAS = [
  "TiviMate/5.1.0",
  "IPTV Smarters Pro/4.0",
  "okhttp/4.12.0",
  "VLC/3.5.4",
  "Mozilla/5.0 (Linux; Android 14)",
];

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
  timeoutMs = 8_000,
  uaOverride?: string,
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
    const headers = uaOverride
      ? { ...IPTV_HEADERS, "User-Agent": uaOverride }
      : IPTV_HEADERS;
    return await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Falha na conexão nativa Android: ${message}`);
  }
}

// Portas Xtream mais comuns. No APK não podemos desistir cedo demais: alguns
// painéis retornam 403 no host raiz e só respondem na porta real da lista.
const COMMON_XTREAM_PORTS = ["", "80", "8080", "8081", "8880", "25461", "2052", "2082", "2095", "8000", "8001", "8088"] as const;

function parseNativeJson(data: unknown) {
  if (typeof data === "string") return JSON.parse(data);
  return data;
}

async function nativeApi<T = unknown>(
  c: XtreamCreds,
  action?: string,
  params?: Record<string, string | number>,
  uaOverride?: string,
): Promise<T | null> {
  const url = new URL(`${normalizeServer(c.server)}/player_api.php`);
  url.searchParams.set("username", c.username);
  url.searchParams.set("password", c.password);
  if (action) url.searchParams.set("action", action);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  }

  const res = await nativeHttpGet(url.toString(), 8_000, uaOverride);
  if (!res) return null;
  if (res.status === 401 || res.status === 403) {
    const err = new Error(`Xtream respondeu HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
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
  let hasExplicitPort = false;
  try {
    const u = new URL(base);
    hasExplicitPort = !!u.port;
    if (!hasExplicitPort) {
      for (const scheme of ["http", "https"]) {
        for (const port of COMMON_XTREAM_PORTS) {
          candidates.add(`${scheme}://${u.hostname}${port ? `:${port}` : ""}`);
        }
      }
    }
  } catch {
    // keep normalized base only
  }

  // Apenas UA padrão (XCIPTV/6.0) ou UA já memorizado para o host.
  // A rotação ampla de UAs no login nativo causou regressão em painéis que
  // aceitavam o UA padrão (athra.sbs) — mantida apenas para reprodução de stream.
  const preferred = getUAHint(c.server);
  const uas: (string | undefined)[] = preferred ? [preferred, undefined] : [undefined];

  let lastError: unknown = null;
  for (const server of candidates) {
    let authBlocked = false;
    for (const ua of uas) {
      try {
        const data = await nativeApi<T>({ ...c, server }, action, params, ua);
        if (data) {
          if (ua) setUAHint(server, ua);
          return { data, creds: { ...c, server } };
        }
      } catch (err) {
        lastError = err;
        const status = (err as { status?: number })?.status;
        if (status === 401 || status === 403) {
          // Tenta próximo UA no mesmo server.
          authBlocked = true;
          continue;
        }
        break; // erro de rede/timeout: pula pro próximo server, mas continua testando portas
      }
    }
    // Se todos os UAs falharam por 401/403 em um server com porta explícita,
    // ele provavelmente é o correto e as credenciais foram rejeitadas. Porém,
    // quando o usuário salvou só o host sem porta (ex.: athra.sbs), o host raiz
    // pode responder 403 enquanto a porta IPTV real funciona. Nesse caso NÃO
    // desistimos no primeiro 403: seguimos testando as portas candidatas.
    if (authBlocked && server === base && hasExplicitPort) {
      throw lastError;
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
  //    vai DIRETO pro proxy do server-fn — sem chamar api() de novo, porque
  //    api() repetiria o waterfall nativo que já falhou acima (custo dobrado
  //    no APK cold-start).
  let r: { user_info?: { auth?: number | string; status?: string }; server_info?: unknown } | undefined =
    nativeRes?.data;
  if (!r) {
    const preferredUA = getUAHint(c.server);
    const proxied = await xtreamApi({ data: { ...c, preferredUA } });
    if (!proxied.ok) {
      const msg =
        "error" in proxied && typeof proxied.error === "string"
          ? proxied.error
          : "Resposta inválida do servidor";
      throw new Error(msg);
    }
    if ("ua" in proxied && typeof proxied.ua === "string") setUAHint(c.server, proxied.ua);
    r = proxied.data as typeof r;
  }
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

// Limite de segurança para evitar OOM em listas absurdamente grandes
// (~250k canais cobre praticamente qualquer painel real).
const MAX_M3U_ENTRIES = 250_000;
const RE_LOGO = /tvg-logo="([^"]+)"/;
const RE_GROUP = /group-title="([^"]+)"/;

/**
 * Parser incremental: percorre o texto via indexOf("\n") em vez de
 * `text.split(...)`, evitando alocar um array gigante com todas as linhas
 * (em listas de 60-80 MB o split chega a dobrar o uso de memória e
 * derruba o WebView do APK). Cada linha é processada e descartada.
 */
export function parseM3U(text: string): M3UEntry[] {
  const out: M3UEntry[] = [];
  let cur: Partial<M3UEntry> | null = null;
  let i = 0;
  const len = text.length;
  let start = 0;
  while (start <= len) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = len;
    // strip \r final e espaços
    let lineEnd = end;
    while (lineEnd > start && (text.charCodeAt(lineEnd - 1) === 13 /* \r */ || text.charCodeAt(lineEnd - 1) === 32)) lineEnd--;
    let lineStart = start;
    while (lineStart < lineEnd && text.charCodeAt(lineStart) === 32) lineStart++;
    if (lineEnd > lineStart) {
      const first = text.charCodeAt(lineStart);
      if (first === 35 /* # */) {
        // só nos importa #EXTINF
        if (text.startsWith("#EXTINF", lineStart)) {
          const line = text.slice(lineStart, lineEnd);
          const comma = line.indexOf(",");
          const name = comma >= 0 ? line.slice(comma + 1).trim() : "";
          const logo = RE_LOGO.exec(line)?.[1];
          const group = RE_GROUP.exec(line)?.[1];
          cur = { name, logo, group };
        }
      } else if (cur) {
        const url = text.slice(lineStart, lineEnd);
        out.push({
          id: `m3u-${i++}`,
          url,
          name: cur.name || "Sem nome",
          logo: cur.logo,
          group: cur.group,
        });
        cur = null;
        if (out.length >= MAX_M3U_ENTRIES) break;
      }
    }
    start = end + 1;
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
  for (const target of candidates) {
    try {
      const res = await nativeHttpGet(target, 30_000);
      if (!res) return null;
      lastStatus = res.status;
      if (res.status < 200 || res.status >= 300) continue;
      const text = typeof res.data === "string" ? res.data : String(res.data ?? "");
      const entries = parseM3U(text);
      if (entries.length) return entries;
    } catch (err) {
      lastError = err;
      continue;
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
