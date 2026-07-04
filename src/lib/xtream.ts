import { discoverPanelXtreamServer, xtreamApi, fetchM3U } from "./xtream.functions";
import { store, type XtreamCreds } from "./storage";
import { m3uCache } from "./m3u-cache";
import { getUAHint, setUAHint } from "./ua-hint";

export type LiveCategory = { category_id: string; category_name: string };
export type LiveStream = {
  num: number;
  name: string;
  stream_id: number;
  stream_icon: string;
  category_id: string;
  epg_channel_id?: string;
  tv_archive?: number;
  tv_archive_duration?: number | string;
  url?: string;
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

const isBrowser = () => typeof window !== "undefined";

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
  timeoutMs = 8_000,
): Promise<T | null> {
  const url = new URL(`${normalizeServer(c.server)}/player_api.php`);
  url.searchParams.set("username", c.username);
  url.searchParams.set("password", c.password);
  if (action) url.searchParams.set("action", action);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  }

  const res = await nativeHttpGet(url.toString(), timeoutMs, uaOverride);
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
  opts: { timeoutMs?: number; totalTimeoutMs?: number; includeHttpsFallback?: boolean } = {},
): Promise<{ data: T; creds: XtreamCreds } | null> {
  if (!(await canUseNativeHttp())) return null;
  const base = normalizeServer(c.server);
  const candidates = new Set<string>([base]);
  let hasExplicitPort = false;
  const perAttemptTimeout = opts.timeoutMs ?? 6_000;
  const totalTimeoutMs = opts.totalTimeoutMs ?? 24_000;
  const startedAt = Date.now();
  try {
    const u = new URL(base);
    hasExplicitPort = !!u.port;
    if (!hasExplicitPort) {
      // Não força upgrade HTTP → HTTPS. Testa somente o esquema informado
      // (ou HTTP quando o usuário digitou só o host). HTTPS entra apenas se
      // solicitado explicitamente por opção.
      const primaryScheme = u.protocol === "https:" ? "https" : "http";
      const schemes = opts.includeHttpsFallback
        ? [primaryScheme, primaryScheme === "https" ? "http" : "https"]
        : [primaryScheme];
      for (const scheme of schemes) {
        for (const port of COMMON_XTREAM_PORTS) {
          candidates.add(normalizeServer(`${scheme}://${u.hostname}${port ? `:${port}` : ""}`));
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
    if (Date.now() - startedAt >= totalTimeoutMs) {
      throw new Error("Tempo esgotado ao tentar conectar no servidor Xtream.");
    }
    let authBlocked = false;
    for (const ua of uas) {
      const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) throw new Error("Tempo esgotado ao tentar conectar no servidor Xtream.");
      try {
        const data = await nativeApi<T>(
          { ...c, server },
          action,
          params,
          ua,
          Math.max(1_500, Math.min(perAttemptTimeout, remainingMs)),
        );
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
    const native = await nativeApiWithFallbackPorts<T>(c, action, params, {
      timeoutMs: 5_000,
      totalTimeoutMs: 20_000,
    });
    if (native) return maybePreserveLiveUrls(c, action, native.data as T);
  } catch {
    // segue para o fallback do server-fn
  }

  // Hint: UA que já funcionou para esse host — server-fn tenta esse primeiro.
  const preferredUA = getUAHint(c.server);
  const r = await xtreamApi({
    data: { ...c, action, params, preferredUA, timeoutMs: 10_000 },
  });
  if (!r.ok) {
    const msg =
      "error" in r && typeof r.error === "string" ? r.error : "Resposta inválida do servidor";
    throw new Error(msg);
  }
  // Persistir UA vencedor para acelerar próxima chamada ao mesmo servidor.
  if ("ua" in r && typeof r.ua === "string") setUAHint(c.server, r.ua);
  return maybePreserveLiveUrls(c, action, r.data as T);
}

/**
 * Aceita como válido qualquer objeto Xtream com `stream_id` e `name`.
 * NÃO exige `url` — a maioria dos painéis só devolve `stream_id`+metadados,
 * e a URL é montada com `streamUrl.live(creds, stream_id)` na hora de tocar.
 */
export function isValidLiveStream(stream: unknown): stream is LiveStream {
  if (!stream || typeof stream !== "object") return false;
  const item = stream as Partial<LiveStream>;
  return (
    item.stream_id !== undefined &&
    item.stream_id !== null &&
    Number.isFinite(Number(item.stream_id)) &&
    typeof item.name === "string" &&
    item.name.trim().length > 0
  );
}

/**
 * Normaliza a resposta de `get_live_streams` para `LiveStream[]`.
 * Aceita array direto, string JSON, ou objeto com `data`/`streams`/`live_streams`/`results`.
 * Rejeita HTML, tela de login, objeto de erro. Não descarta canais sem `stream_icon`/`url`.
 */
export function normalizeLiveStreamsResponse(input: unknown): LiveStream[] {
  let value: unknown = input;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("<")) {
      throw new Error("O servidor não retornou uma lista de canais válida.");
    }
    try { value = JSON.parse(trimmed); }
    catch { throw new Error("O servidor não retornou uma lista de canais válida."); }
  }
  if (!Array.isArray(value) && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    value = obj.data ?? obj.streams ?? obj.live_streams ?? obj.results;
  }
  if (!Array.isArray(value)) {
    throw new Error("Resposta Xtream de canais em formato inesperado.");
  }
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const s = item as Record<string, unknown>;
      return {
        ...s,
        stream_id: Number(s.stream_id),
        category_id: String(s.category_id ?? ""),
        name: String(s.name ?? "").trim(),
        stream_icon: String(s.stream_icon ?? ""),
      } as LiveStream;
    })
    .filter(isValidLiveStream);
}

// FIX CRÍTICO (skeleton infinito em Live no APK):
// get_live_streams NÃO pode aguardar download/parse da M3U completa.
// Este merge agora é 100% síncrono e só usa cache em memória (m3uCache.get()).
// Se não houver cache já hidratado → devolve a resposta Xtream original
// imediatamente. Baixar M3U ao selecionar categoria travava a WebView.
//
// A flag `m3uMergeTriggered` (WeakMap por resposta) fica exposta para
// diagnóstico. Nunca dispara fetch/loadM3U/IDB — apenas leitura de Map.
export const __m3uMergeDiagnostics = new WeakMap<object, { triggered: boolean }>();

function getAlreadyLoadedM3UEntriesSync(creds: XtreamCreds): M3UEntry[] {
  if (!isBrowser()) return [];
  try {
    const cached = m3uCache.get();
    if (!cached?.entries?.length) return [];
    // Só usa se a M3U em memória bate com uma das listas salvas dessa conta.
    const lists = store.getM3U();
    const match = lists.some(
      (list) =>
        list.url === cached.url &&
        sameXtreamAccount(
          xtreamCredsFromUrl(list.url, list.username, list.password),
          creds,
        ),
    );
    return match ? cached.entries : [];
  } catch {
    return [];
  }
}

function maybePreserveLiveUrls<T>(c: XtreamCreds, action: string | undefined, data: T): T {
  if (action !== "get_live_streams") return data;
  if (!Array.isArray(data)) return data;
  const entries = getAlreadyLoadedM3UEntriesSync(c);
  if (!entries.length) {
    // Nenhum merge disparado — 0 I/O, retorno instantâneo.
    if (typeof data === "object" && data !== null) {
      __m3uMergeDiagnostics.set(data as unknown as object, { triggered: false });
    }
    return data;
  }
  try {
    const normalized = normalizeLiveStreamsResponse(data);
    const merged = mergeLiveStreamsWithM3UUrls(normalized, entries) as unknown as T;
    if (typeof merged === "object" && merged !== null) {
      __m3uMergeDiagnostics.set(merged as unknown as object, { triggered: true });
    }
    return merged;
  } catch {
    return data;
  }
}


export function extractLiveStreamIdFromUrl(url: string): number | null {
  try {
    const pathname = new URL(url).pathname;
    const match = /\/live\/[^/]+\/[^/]+\/([^/?#]+?)(?:\.[a-z0-9]+)?$/i.exec(pathname);
    const shortMatch = match ?? /\/[^/]+\/[^/]+\/([^/?#]+?)(?:\.[a-z0-9]+)?$/i.exec(pathname);
    if (!shortMatch) return null;
    const id = Number(shortMatch[1]);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function isLiveM3UEntry(entry: M3UEntry): boolean {
  if (/\/live\/[^/]+\/[^/]+\//i.test(entry.url)) return true;
  return !/movie|filme|vod|serie|série|series/i.test(entry.group || "");
}

function m3uEntriesToLiveStreams(entries: M3UEntry[]): LiveStream[] {
  const out: LiveStream[] = [];
  entries.forEach((entry, idx) => {
    if (!isLiveM3UEntry(entry)) return;
    const id = extractLiveStreamIdFromUrl(entry.url);
    if (id == null) return;
    out.push({
      num: idx + 1,
      name: entry.name,
      stream_id: id,
      stream_icon: entry.logo || "",
      category_id: entry.group || "",
      url: entry.url,
    });
  });
  return out;
}

function mergeLiveStreamsWithM3UUrls(streams: LiveStream[], entries: M3UEntry[]): LiveStream[] {
  const byId = new Map<number, LiveStream>();
  for (const m3uStream of m3uEntriesToLiveStreams(entries)) byId.set(m3uStream.stream_id, m3uStream);
  if (!byId.size) return streams;

  const seen = new Set<number>();
  const merged = streams.map((stream) => {
    const fromM3U = byId.get(Number(stream.stream_id));
    seen.add(Number(stream.stream_id));
    return fromM3U?.url ? { ...stream, url: fromM3U.url } : stream;
  });

  for (const [id, fromM3U] of byId) {
    if (!seen.has(id)) merged.push(fromM3U);
  }
  return merged;
}

function sameXtreamAccount(a: XtreamCreds | null, b: XtreamCreds): boolean {
  if (!a) return false;
  try {
    return new URL(normalizeServer(a.server)).host.toLowerCase() ===
      new URL(normalizeServer(b.server)).host.toLowerCase() && a.username === b.username;
  } catch {
    return a.server === b.server && a.username === b.username;
  }
}

async function loadSavedM3UEntriesForCreds(creds: XtreamCreds): Promise<M3UEntry[]> {
  if (!isBrowser()) return [];
  const lists = store.getM3U().filter((list) => sameXtreamAccount(xtreamCredsFromUrl(list.url, list.username, list.password), creds));
  for (const list of lists) {
    const cached = m3uCache.get();
    if (cached?.url === list.url && cached.entries.length) return cached.entries;
    const hydrated = await m3uCache.loadPersisted(list.url);
    const persisted = hydrated ? m3uCache.get() : null;
    if (persisted?.url === list.url && persisted.entries.length) return persisted.entries;
    try {
      const entries = await loadM3U(list.url, list.username, list.password);
      if (entries.length) {
        m3uCache.set(list.url, list.name, entries);
        return entries;
      }
    } catch {
      // Mantém player_api.php funcionando se a M3U falhar.
    }
  }
  return [];
}

export async function preserveOriginalLiveUrls(creds: XtreamCreds, streams: LiveStream[]): Promise<LiveStream[]> {
  const entries = await loadSavedM3UEntriesForCreds(creds);
  return entries.length ? mergeLiveStreamsWithM3UUrls(streams, entries) : streams;
}

export async function login(c: XtreamCreds) {
  // 1) Tenta autenticar pelo Android nativo (mesmo caminho do XCIPTV).
  const nativeAvailable = await canUseNativeHttp();
  let nativeError: unknown = null;
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
    }>(c, undefined, undefined, { timeoutMs: 4_000, totalTimeoutMs: 22_000 });
  } catch (err) {
    nativeError = err;
  }

  // 2) Se nativo não trouxe nada (web OU APK com painel bloqueando UA/IP),
  //    vai DIRETO pro proxy do server-fn — sem chamar api() de novo, porque
  //    api() repetiria o waterfall nativo que já falhou acima (custo dobrado
  //    no APK cold-start).
  let r: { user_info?: { auth?: number | string; status?: string }; server_info?: unknown } | undefined =
    nativeRes?.data;
  if (!r) {
    // No APK, não fica preso no proxy/datacenter depois que o caminho nativo
    // já esgotou. A tela de login falha rápido e o fallback visual decide o
    // próximo passo, em vez de parecer conexão infinita.
    if (nativeAvailable) {
      throw nativeError instanceof Error
        ? nativeError
        : new Error("Não foi possível conectar ao servidor Xtream pelo Android.");
    }
    const preferredUA = getUAHint(c.server);
    const proxied = await xtreamApi({ data: { ...c, preferredUA, timeoutMs: 10_000 } });
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
  let v = s.trim().replace(/\s+/g, "").replace(/^(https?):\/{0,1}(?!\/)/i, "$1://").replace(/\/+$/, "");
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
  let target = (raw || "").trim().replace(/\s+/g, "").replace(/^(https?):\/{0,1}(?!\/)/i, "$1://");
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

export function timeshiftUrl(
  creds: XtreamCreds,
  streamId: string | number,
  startTimestamp: number,
  durationMinutes: number,
): string {
  const d = new Date(startTimestamp * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}:${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const base = normalizeServer(creds.server);
  return `${base}/streaming/timeshift.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}&stream=${streamId}&start=${start}&duration=${durationMinutes}`;
}

// --- M3U parser ---
export type M3UEntry = {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  /** tvg-id → chave para casar com XMLTV (EPG). */
  tvgId?: string;
  /** tvg-name → nome canônico do canal. */
  tvgName?: string;
  /** tvg-chno → número do canal. */
  tvgChno?: string;
  /** #EXTVLCOPT:http-user-agent= */
  userAgent?: string;
  /** #EXTVLCOPT:http-referrer= */
  referer?: string;
  /** catchup / timeshift metadata (Xtream-style). */
  catchup?: string;
  catchupSource?: string;
  catchupDays?: number;
  /** #KODIPROP:inputstream.adaptive.license_key= etc. */
  kodiProps?: Record<string, string>;
  /** #EXTGRP:<group> fallback quando não há group-title. */
  extGroup?: string;
};

export type M3UParseResult = {
  entries: M3UEntry[];
  /** url-tvg="..." declarado no cabeçalho #EXTM3U (para XMLTV). */
  epgUrls: string[];
  truncated: boolean;
};

// Limite de segurança para evitar OOM em listas absurdamente grandes
// (~250k canais cobre praticamente qualquer painel real).
const MAX_M3U_ENTRIES = 250_000;
const RE_ATTR = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
const RE_URL_TVG = /url-tvg="([^"]+)"/i;

interface CancelSignal { aborted: boolean }

/**
 * Parser incremental: percorre o texto via indexOf("\n") em vez de
 * `text.split(...)`, evitando alocar um array gigante com todas as linhas
 * (em listas de 60-80 MB o split chega a dobrar o uso de memória e
 * derruba o WebView do APK). Cada linha é processada e descartada.
 *
 * Suporta: BOM, CRLF, #EXTINF (com atributos tvg-* e catchup-*),
 * #EXTVLCOPT (user-agent/referer), #KODIPROP, #EXTGRP, url-tvg no header,
 * URLs relativas (resolvidas via baseUrl) e cancelamento cooperativo.
 */
export function parseM3UDetailed(
  text: string,
  opts?: { baseUrl?: string; signal?: CancelSignal },
): M3UParseResult {
  const out: M3UEntry[] = [];
  const epgUrls: string[] = [];
  let cur: Partial<M3UEntry> | null = null;
  let kodi: Record<string, string> | null = null;
  let i = 0;
  const len = text.length;
  let start = len > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let sawHeader = false;
  let truncated = false;

  while (start <= len) {
    if (opts?.signal?.aborted) break;
    let end = text.indexOf("\n", start);
    if (end === -1) end = len;
    let lineEnd = end;
    while (lineEnd > start && (text.charCodeAt(lineEnd - 1) === 13 || text.charCodeAt(lineEnd - 1) === 32)) lineEnd--;
    let lineStart = start;
    while (lineStart < lineEnd && text.charCodeAt(lineStart) === 32) lineStart++;
    if (lineEnd > lineStart) {
      const first = text.charCodeAt(lineStart);
      if (first === 35 /* # */) {
        const line = text.slice(lineStart, lineEnd);
        if (!sawHeader && line.startsWith("#EXTM3U")) {
          sawHeader = true;
          const m = RE_URL_TVG.exec(line);
          if (m) {
            for (const u of m[1].split(/[,;\s]+/)) if (u) epgUrls.push(u);
          }
        } else if (line.startsWith("#EXTINF")) {
          const comma = line.indexOf(",");
          const attrs = comma >= 0 ? line.slice(8, comma) : line.slice(8);
          const name = comma >= 0 ? line.slice(comma + 1).trim() : "";
          const entry: Partial<M3UEntry> = { name };
          RE_ATTR.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = RE_ATTR.exec(attrs))) {
            const k = m[1].toLowerCase();
            const v = m[2];
            if (k === "tvg-logo") entry.logo = v;
            else if (k === "group-title") entry.group = v;
            else if (k === "tvg-id") entry.tvgId = v;
            else if (k === "tvg-name") entry.tvgName = v;
            else if (k === "tvg-chno") entry.tvgChno = v;
            else if (k === "catchup") entry.catchup = v;
            else if (k === "catchup-source") entry.catchupSource = v;
            else if (k === "catchup-days") {
              const n = Number(v);
              if (Number.isFinite(n)) entry.catchupDays = n;
            }
          }
          cur = entry;
          kodi = null;
        } else if (line.startsWith("#EXTVLCOPT:") && cur) {
          const kv = line.slice(11);
          const eq = kv.indexOf("=");
          if (eq > 0) {
            const k = kv.slice(0, eq).toLowerCase().trim();
            const v = kv.slice(eq + 1).trim();
            if (k === "http-user-agent") cur.userAgent = v;
            else if (k === "http-referrer" || k === "http-referer") cur.referer = v;
          }
        } else if (line.startsWith("#KODIPROP:") && cur) {
          const kv = line.slice(10);
          const eq = kv.indexOf("=");
          if (eq > 0) {
            if (!kodi) kodi = {};
            kodi[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
          }
        } else if (line.startsWith("#EXTGRP:") && cur) {
          cur.extGroup = line.slice(8).trim();
        }
      } else if (cur) {
        let url = text.slice(lineStart, lineEnd);
        if (opts?.baseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(url)) {
          try { url = new URL(url, opts.baseUrl).toString(); } catch { /* mantém */ }
        }
        if (kodi) cur.kodiProps = kodi;
        out.push({
          id: `m3u-${i++}`,
          url,
          name: cur.name || "Sem nome",
          logo: cur.logo,
          group: cur.group || cur.extGroup,
          tvgId: cur.tvgId,
          tvgName: cur.tvgName,
          tvgChno: cur.tvgChno,
          userAgent: cur.userAgent,
          referer: cur.referer,
          catchup: cur.catchup,
          catchupSource: cur.catchupSource,
          catchupDays: cur.catchupDays,
          kodiProps: cur.kodiProps,
          extGroup: cur.extGroup,
        });
        cur = null;
        kodi = null;
        if (out.length >= MAX_M3U_ENTRIES) { truncated = true; break; }
      }
    }
    start = end + 1;
  }
  return { entries: out, epgUrls, truncated };
}

/**
 * Wrapper retrocompatível: mantém a assinatura antiga usada por todo o app.
 * Use `parseM3UDetailed` quando precisar de url-tvg, VLC opts, kodi props etc.
 */
export function parseM3U(text: string): M3UEntry[] {
  return parseM3UDetailed(text).entries;
}

function preferredM3UOutput(hostname: string): "ts" | "m3u8" {
  const h = (hostname || "").toLowerCase();
  if (h === "flipex.pro" || h.endsWith(".flipex.pro")) return "ts";
  return "ts";
}

function buildClientM3UUrl(raw: string, username?: string, password?: string): string {
  let target = (raw || "").trim().replace(/\s+/g, "").replace(/^(https?):\/{0,1}(?!\/)/i, "$1://");
  if (!target) throw new Error("URL vazia");
  if (!/^https?:\/\//i.test(target)) target = `http://${target}`;
  const u = new URL(target);
  const path = u.pathname.toLowerCase();

  if (path.endsWith("/get.php")) {
    if (username && !u.searchParams.get("username")) u.searchParams.set("username", username);
    if (password && !u.searchParams.get("password")) u.searchParams.set("password", password);
    if (!u.searchParams.get("type")) u.searchParams.set("type", "m3u_plus");
    if (!u.searchParams.get("output")) u.searchParams.set("output", preferredM3UOutput(u.hostname));
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
    out.searchParams.set("output", preferredM3UOutput(u.hostname));
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
  const startedAt = Date.now();
  const totalTimeoutMs = 22_000;
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
      const scheme = u.protocol === "https:" ? "https" : "http";
      const outputs = preferredM3UOutput(u.hostname) === "ts" ? ["ts", "m3u8"] : ["m3u8", "ts"];
      for (const port of COMMON_XTREAM_PORTS) {
        for (const output of outputs) {
          const out = new URL(`${scheme}://${u.hostname}${port ? `:${port}` : ""}/get.php`);
          out.searchParams.set("username", user);
          out.searchParams.set("password", pass);
          out.searchParams.set("type", "m3u_plus");
          out.searchParams.set("output", output);
          candidates.add(out.toString());
        }
      }
      // Se a entrada já veio em HTTPS, tenta HTTP como fallback controlado;
      // se veio em HTTP, não faz upgrade automático para HTTPS.
      if (u.protocol === "https:") {
        for (const port of COMMON_XTREAM_PORTS) {
          for (const output of outputs) {
            const out = new URL(`http://${u.hostname}${port ? `:${port}` : ""}/get.php`);
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
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) throw new Error("Tempo esgotado ao carregar M3U no Android");
    try {
      const res = await nativeHttpGet(target, Math.max(1_500, Math.min(4_000, remainingMs)));
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
