import { createFileRoute } from "@tanstack/react-router";

// Proxy upstream IPTV streams so the browser doesn't hit CORS / mixed-content
// issues. For HLS playlists (.m3u8 / mpegurl) we rewrite the segment URLs so
// they also flow through this proxy.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type, Accept, Origin, Referer, User-Agent",
  // Expõe headers de diagnóstico (X-Upstream-*) para o player ler no client
  // e imprimir relatório completo no console quando ocorrer erro de reprodução.
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type, Location, X-Upstream-Status, X-Upstream-Content-Type, X-Upstream-Final-Url, X-Upstream-Redirect-Location, X-Upstream-Direct-Candidate, X-Upstream-User-Agent, X-Upstream-Origin-Headers, X-Upstream-Redirected, X-Upstream-Redirect-Cookie, X-Upstream-Failure-Class, X-Upstream-Dead-Media-Bases, X-Stream-Redirect-Mode, X-Debug-Phase, X-Debug-Reason, X-Debug-Line",
};

const VOD_CHUNK_SIZE = 16 * 1024 * 1024;

type Debug502Payload = {
  debug_phase: string;
  debug_reason: string;
  debug_line: number;
  exception_message?: string | null;
  exception_stack?: string | null;
  upstream_url?: string | null;
  candidate?: string | null;
  [key: string]: unknown;
};

function debugJsonResponse(status: number, payload: Debug502Payload, headersInit: HeadersInit = CORS) {
  const headers = new Headers(headersInit);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (status === 502) {
    headers.set("X-Debug-Phase", payload.debug_phase);
    headers.set("X-Debug-Reason", payload.debug_reason);
    headers.set("X-Debug-Line", String(payload.debug_line));
    console.error("[API_STREAM_502]", payload);
  }
  return new Response(JSON.stringify(payload, null, 2), { status, headers });
}

function proxyUrl(absolute: string, ua?: string | null, kind?: "live" | "vod") {
  const kindPart = kind === "vod" ? "&kind=vod" : "";
  const uaPart = ua ? `&ua=${encodeURIComponent(ua)}` : "";
  return `/api/stream?u=${encodeURIComponent(absolute)}${kindPart}&v=7${uaPart}`;
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".ts")) return "video/mp2t";
  if (lower.endsWith(".m3u8") || lower.endsWith(".m3u")) return "application/vnd.apple.mpegurl";
  return "video/mp4";
}

function isVodPath(path: string): boolean {
  return /\/movie\/[^/]+\/[^/]+\//i.test(path) || /\/series\/[^/]+\/[^/]+\//i.test(path);
}

function isPlaylistPath(path: string): boolean {
  return /\.m3u8?(\?|$)/i.test(path);
}

function isLikelyVodBlockContentType(contentType: string): boolean {
  return /text\/html|application\/json|application\/xml|text\/xml/i.test(contentType);
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function resolveLocation(location: string | null, baseUrl: URL): string | null {
  if (!location) return null;
  try {
    return new URL(location, baseUrl).toString();
  } catch {
    return null;
  }
}

function splitSetCookieHeader(raw: string): string[] {
  // Fetch em alguns runtimes junta múltiplos Set-Cookie em um único header.
  // Divide apenas em vírgulas que parecem iniciar outro cookie, preservando
  // vírgulas internas de Expires=Wed, 21 Oct...
  return raw.split(/,(?=\s*[^;,\s]+=)/g).map((v) => v.trim()).filter(Boolean);
}

function redirectCookieHeader(headers: Headers): string {
  const values: string[] = [];
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  try {
    const many = withGetSetCookie.getSetCookie?.();
    if (Array.isArray(many)) values.push(...many);
  } catch { /* noop */ }
  const single = headers.get("set-cookie");
  if (single) values.push(...splitSetCookieHeader(single));

  const pairs = values
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter((pair) => /^[^=;\s]+=/.test(pair));
  return Array.from(new Set(pairs)).join("; ");
}

function browserDirectVodCandidate(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    // O preview roda em HTTPS. Se o painel redireciona para CDN HTTP, entregar
    // esse 302 ao browser vira Mixed Content. Como muitos CDNs também aceitam
    // HTTPS no mesmo path, expomos a variante HTTPS para o player tentar direto
    // a partir do IP do usuário (não do datacenter do proxy).
    if (u.protocol === "http:") {
      u.protocol = "https:";
      if (u.port === "80") u.port = "";
    }
    return u.toString();
  } catch {
    return null;
  }
}

function mediaIdentityKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\.[a-z0-9]{2,5}$/i, "");
    return `${u.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

type OriginHeaderMode = "none" | "referer" | "origin";
type RedirectStrategy = "manual" | "follow";
type UpstreamAttempt = {
  ua: string;
  rangeValue: string | null;
  originHeaderMode: OriginHeaderMode;
  redirectStrategy?: RedirectStrategy;
};

function uniqueAttempts(attempts: UpstreamAttempt[]): UpstreamAttempt[] {
  const seen = new Set<string>();
  const out: UpstreamAttempt[] = [];
  for (const attempt of attempts) {
    const key = `${attempt.ua}\n${attempt.rangeValue ?? ""}\n${attempt.originHeaderMode}\n${attempt.redirectStrategy ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(attempt);
  }
  return out;
}

function parseByteRange(range: string | null): { start: number; end?: number } | null {
  const match = /^bytes=(\d+)-(\d*)$/i.exec(range?.trim() ?? "");
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;
  if (!Number.isFinite(start) || start < 0) return null;
  if (end !== undefined && (!Number.isFinite(end) || end < start)) return null;
  return { start, end };
}

function parseContentRangeTotal(value: string | null): number | undefined {
  const total = /bytes\s+\d+-\d+\/(\d+|\*)/i.exec(value ?? "")?.[1];
  if (!total || total === "*") return undefined;
  const n = Number(total);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseContentRange(value: string | null): { start: number; end: number; total?: number } | null {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value?.trim() ?? "");
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === "*" ? undefined : Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  if (total !== undefined && (!Number.isFinite(total) || total <= 0)) return null;
  return { start, end, total };
}

function vodRangeForUpstream(requestedRange: string | null, head = false): string {
  if (head) return "bytes=0-0";
  const parsed = parseByteRange(requestedRange) ?? { start: 0 };
  // VOD no preview web precisa responder como servidor progressivo com Range
  // FINITA. Muitos CDNs Xtream engasgam/bloqueiam `bytes=0-` aberto quando a
  // requisição vem do proxy; o fluxo antigo que funcionava entregava blocos.
  const cappedEnd = Math.min(
    parsed.end ?? parsed.start + VOD_CHUNK_SIZE - 1,
    parsed.start + VOD_CHUNK_SIZE - 1,
  );
  return `bytes=${parsed.start}-${cappedEnd}`;
}

function finiteVodRangeForUpstream(rangeValue: string | null): string | null {
  const parsed = parseByteRange(rangeValue);
  if (!parsed || parsed.end !== undefined) return null;
  // Fallback de compatibilidade: alguns CDNs de VOD não gostam de Range aberta
  // (`bytes=0-`) mas aceitam um primeiro bloco finito, como um servidor de
  // arquivo comum. Mantemos só como tentativa extra; a Range real vem primeiro.
  const end = parsed.start + (4 * 1024 * 1024) - 1;
  return `bytes=${parsed.start}-${end}`;
}

function numericHeader(headers: Headers, name: string): number | undefined {
  const value = Number(headers.get(name));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeVodRangeResponseHeaders(headers: Headers, effectiveRange: string) {
  const parsed = parseByteRange(effectiveRange);
  if (!parsed) return;

  const upstreamRange = parseContentRange(headers.get("content-range"));
  const total = upstreamRange?.total ?? parseContentRangeTotal(headers.get("content-range"));
  const contentLength = numericHeader(headers, "content-length");
  const start = upstreamRange?.start ?? parsed.start;
  const end = upstreamRange?.end ?? parsed.end ?? (contentLength !== undefined ? start + contentLength - 1 : total !== undefined ? total - 1 : undefined);
  if (end === undefined || end < start) return;

  const bodyLength = end - start + 1;
  headers.set("Content-Length", String(bodyLength));
  headers.set("Content-Range", `bytes ${start}-${end}/${total ?? "*"}`);
  headers.set("Accept-Ranges", "bytes");
}

function sliceReadableStream(
  body: ReadableStream<Uint8Array> | null,
  skipBytes: number,
  takeBytes: number,
): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  const reader = body.getReader();
  let skip = Math.max(0, skipBytes);
  let remaining = Math.max(0, takeBytes);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (remaining > 0) {
          const { done, value } = await reader.read();
          if (done || !value) {
            controller.close();
            return;
          }

          let chunk = value;
          if (skip > 0) {
            if (chunk.byteLength <= skip) {
              skip -= chunk.byteLength;
              continue;
            }
            chunk = chunk.slice(skip);
            skip = 0;
          }

          if (chunk.byteLength > remaining) {
            controller.enqueue(chunk.slice(0, remaining));
            remaining = 0;
            try { await reader.cancel(); } catch { /* noop */ }
            controller.close();
            return;
          }

          controller.enqueue(chunk);
          remaining -= chunk.byteLength;
          if (remaining === 0) {
            try { await reader.cancel(); } catch { /* noop */ }
            controller.close();
          }
          return;
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function rewritePlaylist(text: string, baseUrl: string, ua?: string | null, kind?: "live" | "vod"): string {
  const base = new URL(baseUrl);
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      // URI="..." attributes (EXT-X-KEY, EXT-X-MAP, etc.)
      const withUri = line.replace(/URI="([^"]+)"/g, (_, uri) => {
        try {
          return `URI="${proxyUrl(new URL(uri, base).toString(), ua, kind)}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
      if (withUri.startsWith("#")) return withUri;
      // bare URL line (segment / sub-playlist)
      try {
        return proxyUrl(new URL(withUri, base).toString(), ua, kind);
      } catch {
        return withUri;
      }
    })
    .join("\n");
}

async function handle(request: Request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("u");
  if (!target) {
    return new Response("missing ?u", { status: 400, headers: CORS });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(target);
  } catch {
    return new Response("invalid url", { status: 400, headers: CORS });
  }
  if (!/^https?:$/.test(upstreamUrl.protocol)) {
    return new Response("bad protocol", { status: 400, headers: CORS });
  }

  const range = request.headers.get("range");
  const playlistPath = isPlaylistPath(upstreamUrl.pathname);
  const vodContext = url.searchParams.get("kind") === "vod" || isVodPath(upstreamUrl.pathname);
  const isVod = !playlistPath && vodContext;
  const isDiagProbe = url.searchParams.get("probe") === "1";
  const isRedirectPeek = vodContext && url.searchParams.get("redirect") === "peek";
  const effectiveVodRange = isVod ? vodRangeForUpstream(range, request.method === "HEAD") : null;

  // Alguns provedores Xtream bloqueiam UAs específicos (notadamente "VLC")
  // ou exigem cabeçalhos parecidos com IPTV Smarters. Tentamos uma lista de
  // UAs até obter algo que não seja 403/401. Se o cliente passar &ua=,
  // priorizamos esse UA (permite override por lista).
  const DEFAULT_UAS = [
    "XCIPTV/7.0 (Linux; Android 13)",
    "TiviMate/5.1.0",
    "IPTV Smarters Pro/4.0",
    "VLC/3.5.4",
    "okhttp/4.12.0",
    "Mozilla/5.0 (Linux; Android 14)",
    // Fallback adicional (UAs antigos que ainda funcionam em painéis legados)
    "XCIPTV/6.0 (Linux; Android 11) okhttp/4.9.3",
    "Xciptv/6.0",
    "IPTVSmartersPro/3.1.5",
    "TiviMate/4.7.0",
    "okhttp/4.9.3",
    "Lavf/58.76.100",
    "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "VLC/3.0.20 LibVLC/3.0.20",
  ];
  const VOD_UAS = [
    // No preview web desktop, alguns CDNs liberam VOD para UA de navegador e
    // bloqueiam UAs IPTV vindos de datacenter. Mantém o fluxo web antigo:
    // desktop primeiro, IPTV como fallback.
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ...DEFAULT_UAS,
  ];
  const forcedUA = url.searchParams.get("ua");
  const UA_CANDIDATES = forcedUA
    ? Array.from(new Set([forcedUA, ...(vodContext ? VOD_UAS : DEFAULT_UAS)]))
    : (vodContext ? Array.from(new Set(VOD_UAS)) : DEFAULT_UAS);


  const buildHeaders = (ua: string, rangeValue: string | null, originHeaderMode: "none" | "referer" | "origin", headerUrl: URL = upstreamUrl, cookieHeader?: string | null) => {
    const h = new Headers();
    h.set("User-Agent", ua);
    h.set("Accept", playlistPath ? "application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.8" : isVod ? "video/*,*/*;q=0.9" : "*/*");
    h.set("Accept-Language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7");
    h.set("Accept-Encoding", "identity");
    h.set("Icy-MetaData", "0");
    if (originHeaderMode === "referer" || originHeaderMode === "origin") {
      // VOD redirecionado em alguns painéis valida o Referer completo da URL
      // Xtream original. Usar só a raiz do host ainda resultava em falso 404
      // no CDN final; para o próprio host original mandamos path completo.
      const referer = headerUrl.origin === upstreamUrl.origin ? upstreamUrl.toString() : `${headerUrl.origin}/`;
      h.set("Referer", referer);
    }
    if (originHeaderMode === "origin") {
      h.set("Origin", headerUrl.origin);
    }
    if (cookieHeader) h.set("Cookie", cookieHeader);
    if (rangeValue) h.set("Range", rangeValue);
    return h;
  };

  const classifyVodFailure = (status: number, redirected: boolean, contentType: string): string => {
    if (vodContext && status === 404 && redirected && isLikelyVodBlockContentType(contentType)) return "redirected-cdn-404-html";
    if (vodContext && status >= 200 && status < 300 && isLikelyVodBlockContentType(contentType)) return "vod-non-video-response";
    if (vodContext && (status === 401 || status === 403)) return "vod-auth-block";
    if (vodContext && status >= 500) return "vod-upstream-server-error";
    return "";
  };

  const shouldRetryVodResponse = (res: Response, rangeValue: string | null, redirected: boolean, contentType: string, finalUrl: string): boolean => {
    const retryBlocked = res.status === 401 || res.status === 403;
    const retryBadRange = isVod && !!rangeValue && (res.status === 400 || res.status === 416);
    const retryVodServerError = vodContext && (res.status === 408 || res.status === 429 || res.status >= 500);
    const retryVodCompat404 = vodContext && res.status === 404 && (!redirected || (redirectedVod404Count < 10 && redirectedVod404HtmlCount < 8));
    const retryVodBadContent = vodContext && res.ok && isLikelyVodBlockContentType(contentType);
    return retryBlocked || retryBadRange || retryVodCompat404 || retryVodBadContent || retryVodServerError;
  };

  const shouldTryNextRedirectHeader = (res: Response, rangeValue: string | null, contentType: string, finalUrl: string): boolean => {
    if (!vodContext) return false;
    if (res.status === 404) return true;
    if (res.status === 401 || res.status === 403) return true;
    if (isVod && !!rangeValue && (res.status === 400 || res.status === 416)) return true;
    if (res.status === 408 || res.status === 429 || res.status >= 500) return true;
    if (res.ok && isLikelyVodBlockContentType(contentType)) return true;
    return false;
  };

  const finalRedirectHeaderPlans = (initialMode: OriginHeaderMode, finalUrl: URL) => {
    const plans = [
      { originHeaderMode: initialMode, headerUrl: upstreamUrl },
      { originHeaderMode: "none" as const, headerUrl: upstreamUrl },
      { originHeaderMode: "referer" as const, headerUrl: upstreamUrl },
      { originHeaderMode: "origin" as const, headerUrl: upstreamUrl },
      { originHeaderMode: "referer" as const, headerUrl: finalUrl },
      { originHeaderMode: "origin" as const, headerUrl: finalUrl },
    ];
    const seen = new Set<string>();
    return plans.filter((p) => {
      const key = `${p.originHeaderMode}|${p.headerUrl.origin}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  let upstream: Response | null = null;
  let lastError: unknown = null;
  let lastStatus = 0;
  // Diagnóstico: registra qual UA / header set / URL final realmente respondeu
  // (independente de 2xx). Vai como X-Upstream-* na resposta pro client logar.
  let usedUA = "";
  let usedOriginHeaders = false;
  let usedFinalUrl = upstreamUrl.toString();
  let usedRedirectLocation = "";
  let usedDirectCandidate = "";
  let usedRedirected = false;
  let usedRedirectCookie = false;
  let usedFailureClass = "";
  let redirectedVod404Count = 0;
  let redirectedVod404HtmlCount = 0;
  const redirectedVodDeadBases = new Set<string>();
  // Trilha completa de tentativas — chave para diagnosticar 502/timeout no client.
  type AttemptTrace = {
    n: number;
    ua: string;
    range: string | null;
    originHeaderMode: OriginHeaderMode;
    redirectStrategy?: RedirectStrategy;
    phase: "fetch" | "manual-redirect" | "final-follow";
    finalUrl?: string;
    finalProtocol?: string;
    redirectLocation?: string;
    status?: number;
    contentType?: string;
    redirected?: boolean;
    error?: string;
    errorName?: string;
    ttfbMs?: number;
    durationMs: number;
  };
  const attemptTraces: AttemptTrace[] = [];
  // ===== Probe matrix (probe=1): mede HEAD vs GET 0-1 vs GET full =====
  type ProbeMatrixRow = {
    method: string;
    range: string | null;
    url: string;
    protocol: string;
    status: number | null;
    contentType: string | null;
    contentLength: string | null;
    acceptRanges: string | null;
    ttfbMs: number | null;
    totalMs: number;
    error: string | null;
    errorName: string | null;
    aborted: boolean;
  };
  const probeMatrix: ProbeMatrixRow[] = [];
  const runProbeRow = async (method: string, url: string, rangeValue: string | null, ua: string): Promise<void> => {
    const controller = new AbortController();
    const timeoutMs = 30_000;
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let ttfbMs: number | null = null;
    let row: ProbeMatrixRow = {
      method,
      range: rangeValue,
      url,
      protocol: (() => { try { return new URL(url).protocol; } catch { return ""; } })(),
      status: null,
      contentType: null,
      contentLength: null,
      acceptRanges: null,
      ttfbMs: null,
      totalMs: 0,
      error: null,
      errorName: null,
      aborted: false,
    };
    try {
      const res = await fetch(url, {
        method,
        headers: buildHeaders(ua, rangeValue, "none"),
        redirect: "follow",
        signal: controller.signal,
      });
      ttfbMs = Date.now() - startedAt;
      row.status = res.status;
      row.contentType = res.headers.get("content-type");
      row.contentLength = res.headers.get("content-length");
      row.acceptRanges = res.headers.get("accept-ranges");
      row.ttfbMs = ttfbMs;
      row.protocol = (() => { try { return new URL(res.url || url).protocol; } catch { return row.protocol; } })();
      row.url = res.url || url;
      try { await res.body?.cancel(); } catch { /* noop */ }
    } catch (e) {
      const err = e as { name?: string; message?: string } | null;
      row.error = err?.message || String(e);
      row.errorName = err?.name || "Error";
      row.aborted = err?.name === "AbortError";
    } finally {
      clearTimeout(timer);
      row.totalMs = Date.now() - startedAt;
      probeMatrix.push(row);
    }
  };
  // Atalho: se o upstream redireciona para o placeholder
  // "vod_nao_encontrado" do painel Hostinger, o asset NÃO existe. Detectar
  // isso evita queimar 50 tentativas (que estouram o timeout do Worker e o
  // browser vê 502 em vez do 404 real).
  const isPlaceholderNotFoundUrl = (u: string | null | undefined): boolean =>
    !!u && /vod_nao_encontrado|nao_encontrado|not_found/i.test(u);
  const rangeCandidates = isVod
    ? Array.from(new Set([effectiveVodRange, finiteVodRangeForUpstream(effectiveVodRange), range, "bytes=0-", null]))
    : playlistPath
      ? [range]
      : Array.from(new Set([range, "bytes=0-", null]));
  const originHeaderModes: OriginHeaderMode[] = vodContext
    ? ["none", "referer", "origin"]
    : ["none", "origin"];

  // ===== [VOD FAST PATH WEB] ============================================
  // Restaura o comportamento histórico simples para VOD no preview web:
  // 1 UA de navegador + redirect:"follow" + Range do cliente. A maioria
  // dos painéis Xtream respondem direto a esse fluxo. Só se falhar é que
  // entramos no waterfall pesado (UA cycling + redirect manual + cookies).
  // Importante: NÃO afeta APK (que prefere bypass de proxy) nem LIVE
  // (que tem caminho separado). Só ativa para VOD não-playlist no GET real.
  const vodFastPath: UpstreamAttempt[] = isVod && !isDiagProbe && !isRedirectPeek && request.method !== "HEAD"
    ? [
        { ua: VOD_UAS[0], rangeValue: range || effectiveVodRange, originHeaderMode: "none" as const, redirectStrategy: "follow" as const },
        { ua: VOD_UAS[1], rangeValue: range || effectiveVodRange, originHeaderMode: "none" as const, redirectStrategy: "follow" as const },
      ]
    : [];

  const attemptPlans: UpstreamAttempt[] = isVod
    ? uniqueAttempts([
        ...vodFastPath,
        ...UA_CANDIDATES.flatMap((ua) => [
        // Waterfall por UA: se XCIPTV funcionar sem Range/Referer, não espera
        // todos os outros UAs falharem primeiro. Isso reduz timeout no preview.
        { ua, rangeValue: effectiveVodRange, originHeaderMode: "none" as const },
        { ua, rangeValue: finiteVodRangeForUpstream(effectiveVodRange), originHeaderMode: "none" as const },
        { ua, rangeValue: null, originHeaderMode: "none" as const },
        { ua, rangeValue: effectiveVodRange, originHeaderMode: "referer" as const },
        { ua, rangeValue: finiteVodRangeForUpstream(effectiveVodRange), originHeaderMode: "referer" as const },
        { ua, rangeValue: null, originHeaderMode: "referer" as const },
        { ua, rangeValue: effectiveVodRange, originHeaderMode: "origin" as const },
        { ua, rangeValue: range, originHeaderMode: "none" as const },
        ]),
      ])
    : uniqueAttempts(UA_CANDIDATES.flatMap((ua) =>
        rangeCandidates.flatMap((rangeValue) =>
          originHeaderModes.map((originHeaderMode) => ({ ua, rangeValue, originHeaderMode })),
        ),
      ));

  if (isRedirectPeek) {
    const peekHeaders = new Headers(CORS);
    let peekStatus = 0;
    let peekCt = "";
    let peekUA = "";
    let peekOriginHeaders = false;
    let peekLocation = "";
    let peekDirect = "";
    let peekRedirectCookie = false;
    let peekFailureClass = "";
    const peekDeadBases = new Set<string>();
    for (const { ua, rangeValue, originHeaderMode } of attemptPlans.slice(0, 18)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7_000);
      try {
        let attemptFailureClass = "";
        const res = await fetch(upstreamUrl.toString(), {
          method: "GET",
          headers: buildHeaders(ua, rangeValue, originHeaderMode),
          redirect: "manual",
          signal: controller.signal,
        });
        peekStatus = res.status;
        peekCt = res.headers.get("content-type") || "";
        peekUA = ua;
        peekOriginHeaders = originHeaderMode !== "none";
        const loc = resolveLocation(res.headers.get("location"), upstreamUrl);
        if (isRedirectStatus(res.status) && loc) {
          peekLocation = loc;
          peekDirect = browserDirectVodCandidate(loc) || "";
          const cookieHeader = redirectCookieHeader(res.headers);
          peekRedirectCookie = !!cookieHeader;
          try {
            const direct = browserDirectVodCandidate(loc);
            const finalUrlCandidates = Array.from(new Set([loc, direct].filter(Boolean) as string[]));
            for (const finalUrl of finalUrlCandidates) {
              const finalUrlForHeaders = new URL(finalUrl);
              for (const plan of finalRedirectHeaderPlans(originHeaderMode, finalUrlForHeaders)) {
                const finalRes = await fetch(finalUrl, {
                  method: "GET",
                  headers: buildHeaders(ua, rangeValue || "bytes=0-0", plan.originHeaderMode, plan.headerUrl, cookieHeader),
                  redirect: "follow",
                  signal: controller.signal,
                });
                const finalCt = finalRes.headers.get("content-type") || "";
                peekStatus = finalRes.status;
                peekCt = finalCt;
                peekOriginHeaders = plan.originHeaderMode !== "none";
                peekDirect = browserDirectVodCandidate(finalRes.url || finalUrl) || direct || peekDirect;
                attemptFailureClass = classifyVodFailure(finalRes.status, true, finalCt);
                if (finalRes.status === 404 && isLikelyVodBlockContentType(finalCt)) {
                  const deadBase = mediaIdentityKey(finalRes.url || finalUrl);
                  if (deadBase) peekDeadBases.add(deadBase);
                }
                const retryFinal = shouldTryNextRedirectHeader(finalRes, rangeValue, finalCt, finalRes.url || finalUrl);
                try { await finalRes.body?.cancel(); } catch { /* noop */ }
                if (!retryFinal) break;
              }
              if (!attemptFailureClass) break;
            }
          } catch { /* só diagnóstico/otimização; não bloqueia o candidato direto */ }
        }
        try { await res.body?.cancel(); } catch { /* noop */ }
        if (peekDirect) {
          peekFailureClass = attemptFailureClass;
          // Se o redirect atual caiu em CDN morto/HTML, não pare no primeiro:
          // tente outros UAs/headers, pois alguns painéis entregam CDN diferente
          // conforme User-Agent/Referer. Só encerra quando o destino parece mídia.
          if (!attemptFailureClass) break;
        }
      } catch (e) {
        lastError = e;
      } finally {
        clearTimeout(timeout);
      }
    }
    peekHeaders.set("X-Upstream-Status", String(peekStatus || 0));
    peekHeaders.set("X-Upstream-Content-Type", peekCt);
    peekHeaders.set("X-Upstream-Final-Url", upstreamUrl.toString());
    peekHeaders.set("X-Upstream-Redirect-Location", peekLocation);
    peekHeaders.set("X-Upstream-Direct-Candidate", peekDirect);
    peekHeaders.set("X-Upstream-User-Agent", peekUA || (forcedUA ?? ""));
    peekHeaders.set("X-Upstream-Origin-Headers", peekOriginHeaders ? "1" : "0");
    peekHeaders.set("X-Upstream-Redirected", peekLocation ? "1" : "0");
    peekHeaders.set("X-Upstream-Redirect-Cookie", peekRedirectCookie ? "1" : "0");
    peekHeaders.set("X-Upstream-Failure-Class", peekFailureClass);
    if (peekDeadBases.size) peekHeaders.set("X-Upstream-Dead-Media-Bases", Array.from(peekDeadBases).join(","));
    peekHeaders.set("X-Stream-Redirect-Mode", "peek");
    return new Response(null, { status: 204, headers: peekHeaders });
  }

  attempt: for (const { ua, rangeValue, originHeaderMode, redirectStrategy } of attemptPlans) {
        const attemptStart = Date.now();
        const trace: AttemptTrace = {
          n: attemptTraces.length + 1,
          ua,
          range: rangeValue,
          originHeaderMode,
          redirectStrategy,
          phase: "fetch",
          durationMs: 0,
        };
        attemptTraces.push(trace);
        try {
          const controller = new AbortController();
          const timeoutMs = isDiagProbe ? 30_000 : playlistPath ? 7_000 : redirectStrategy === "follow" ? 12_000 : 20_000;
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          const fetchStartedAt = Date.now();
          let res: Response;
          let resolvedRedirectManually = false;
          try {
            const upstreamMethod = (request.method === "HEAD" || isDiagProbe) && vodContext ? "GET" : request.method === "HEAD" ? "HEAD" : "GET";
            if (vodContext && upstreamMethod === "GET" && redirectStrategy === "follow") {
              res = await fetch(upstreamUrl.toString(), {
                method: "GET",
                headers: buildHeaders(ua, rangeValue, originHeaderMode),
                redirect: "follow",
                signal: controller.signal,
              });
              trace.finalUrl = res.url || upstreamUrl.toString();
              if (isPlaceholderNotFoundUrl(trace.finalUrl)) {
                trace.phase = "final-follow";
                trace.status = 404;
                trace.contentType = res.headers.get("content-type") || "";
                trace.redirected = true;
                lastStatus = 404;
                usedUA = ua;
                usedFinalUrl = trace.finalUrl!;
                usedRedirected = true;
                usedFailureClass = "vod-placeholder-not-found";
                trace.durationMs = Date.now() - attemptStart;
                try { await res.body?.cancel(); } catch { /* noop */ }
                break attempt;
              }
            } else if (vodContext && upstreamMethod === "GET") {
              const first = await fetch(upstreamUrl.toString(), {
                method: "GET",
                headers: buildHeaders(ua, rangeValue, originHeaderMode),
                redirect: "manual",
                signal: controller.signal,
              });
              const loc = resolveLocation(first.headers.get("location"), upstreamUrl);
              trace.phase = "manual-redirect";
              trace.redirectLocation = loc ?? undefined;
              if (isRedirectStatus(first.status) && loc && isPlaceholderNotFoundUrl(loc)) {
                trace.status = 404;
                trace.contentType = first.headers.get("content-type") || "";
                trace.redirected = true;
                lastStatus = 404;
                usedUA = ua;
                usedFinalUrl = loc;
                usedRedirectLocation = loc;
                usedRedirected = true;
                usedFailureClass = "vod-placeholder-not-found";
                trace.durationMs = Date.now() - attemptStart;
                try { await first.body?.cancel(); } catch { /* noop */ }
                break attempt;
              }
              if (isRedirectStatus(first.status) && loc) {
                resolvedRedirectManually = true;
                try { await first.body?.cancel(); } catch { /* noop */ }
                usedRedirectLocation = loc;
                const cookieHeader = redirectCookieHeader(first.headers);
                usedRedirectCookie = !!cookieHeader;
                const direct = browserDirectVodCandidate(loc);
                const finalUrlCandidates = Array.from(new Set([loc, direct].filter(Boolean) as string[]));
                let lastFinal: Response | null = null;
                for (const finalUrl of finalUrlCandidates) {
                  const finalUrlObj = new URL(finalUrl);
                  for (const plan of finalRedirectHeaderPlans(originHeaderMode, finalUrlObj)) {
                    const finalRes = await fetch(finalUrl, {
                      method: "GET",
                      headers: buildHeaders(ua, rangeValue, plan.originHeaderMode, plan.headerUrl, cookieHeader),
                      redirect: "follow",
                      signal: controller.signal,
                    });
                    const finalCt = finalRes.headers.get("content-type") || "";
                    if (lastFinal) {
                      try { await lastFinal.body?.cancel(); } catch { /* noop */ }
                    }
                    lastFinal = finalRes;
                    usedOriginHeaders = plan.originHeaderMode !== "none";
                    usedFinalUrl = finalRes.url || finalUrl;
                    usedRedirected = true;
                    usedDirectCandidate = browserDirectVodCandidate(usedFinalUrl) || direct || "";
                    usedFailureClass = classifyVodFailure(finalRes.status, true, finalCt);
                    if (finalRes.status === 404 && isLikelyVodBlockContentType(finalCt)) {
                      const deadBase = mediaIdentityKey(usedFinalUrl);
                      if (deadBase) redirectedVodDeadBases.add(deadBase);
                    }
                    if (!shouldTryNextRedirectHeader(finalRes, rangeValue, finalCt, usedFinalUrl)) break;
                  }
                  if (lastFinal && !shouldTryNextRedirectHeader(lastFinal, rangeValue, lastFinal.headers.get("content-type") || "", usedFinalUrl)) break;
                }
                res = lastFinal ?? first;
              } else {
                res = first;
              }
            } else {
              res = await fetch(upstreamUrl.toString(), {
                method: upstreamMethod,
                headers: buildHeaders(ua, rangeValue, originHeaderMode),
                redirect: "follow",
                signal: controller.signal,
              });
            }
          } finally {
            clearTimeout(timeout);
          }
          trace.ttfbMs = Date.now() - fetchStartedAt;
          lastStatus = res.status;
          usedUA = ua;
          if (!resolvedRedirectManually) {
            usedOriginHeaders = originHeaderMode !== "none";
            usedFinalUrl = res.url || upstreamUrl.toString();
            usedRedirected = !!res.redirected || usedFinalUrl !== upstreamUrl.toString();
            usedDirectCandidate = vodContext && usedRedirected ? (browserDirectVodCandidate(usedFinalUrl) || "") : "";
          }
          const upstreamCt = res.headers.get("content-type") || "";
          usedFailureClass = classifyVodFailure(res.status, usedRedirected, upstreamCt);
          trace.status = res.status;
          trace.contentType = upstreamCt;
          trace.finalUrl = usedFinalUrl;
          try { trace.finalProtocol = new URL(usedFinalUrl).protocol; } catch { /* noop */ }
          trace.redirected = usedRedirected;
          trace.durationMs = Date.now() - attemptStart;
          if (vodContext && usedRedirected && isPlaceholderNotFoundUrl(usedFinalUrl)) {
            usedFailureClass = "vod-placeholder-not-found";
            lastStatus = 404;
            try { await res.body?.cancel(); } catch { /* noop */ }
            break attempt;
          }
          if (vodContext && res.status === 404 && usedRedirected) {
            redirectedVod404Count += 1;
            if (isLikelyVodBlockContentType(upstreamCt)) {
              redirectedVod404HtmlCount += 1;
              const deadBase = mediaIdentityKey(usedFinalUrl);
              if (deadBase) redirectedVodDeadBases.add(deadBase);
            }
          }
          if (isDiagProbe) {
            upstream = res;
            // ===== Probe matrix: HEAD, GET 0-1, GET full contra a URL final =====
            try {
              const targetUrl = usedFinalUrl || upstreamUrl.toString();
              await runProbeRow("HEAD", targetUrl, null, ua);
              await runProbeRow("GET", targetUrl, "bytes=0-1", ua);
              await runProbeRow("GET", targetUrl, null, ua);
            } catch { /* diagnóstico não bloqueia */ }
            break attempt;
          }
          if (!shouldRetryVodResponse(res, rangeValue, usedRedirected, upstreamCt, usedFinalUrl)) {
            upstream = res;
            break attempt;
          }
          try { await res.body?.cancel(); } catch { /* noop */ }
        } catch (e) {
          lastError = e;
          const err = e as { name?: string; message?: string } | null;
          trace.error = err?.message || String(e);
          trace.errorName = err?.name || "Error";
          trace.durationMs = Date.now() - attemptStart;
          trace.ttfbMs = trace.ttfbMs ?? (Date.now() - fetchStartedAt);
          if (isDiagProbe) {
            usedUA = ua;
            usedOriginHeaders = originHeaderMode !== "none";
            usedFailureClass = err?.name === "AbortError" ? "probe-timeout" : "probe-network-error";
            // Probe matrix mesmo no abort — testa o destino redirecionado
            // (se houver) ou a URL original, com 30s por método.
            try {
              const targetUrl = usedRedirectLocation || usedFinalUrl || upstreamUrl.toString();
              await runProbeRow("HEAD", targetUrl, null, ua);
              await runProbeRow("GET", targetUrl, "bytes=0-1", ua);
              await runProbeRow("GET", targetUrl, null, ua);
            } catch { /* diagnóstico não bloqueia */ }
            break attempt;
          }
        }
  }
  if (!upstream) {
    const failHeaders = new Headers(CORS);
    failHeaders.set("X-Upstream-Status", String(lastStatus || 0));
    failHeaders.set("X-Upstream-Final-Url", usedFinalUrl || upstreamUrl.toString());
    failHeaders.set("X-Upstream-Redirect-Location", usedRedirectLocation);
    failHeaders.set("X-Upstream-Direct-Candidate", usedDirectCandidate);
    failHeaders.set("X-Upstream-User-Agent", usedUA || (forcedUA ?? ""));
    failHeaders.set("X-Upstream-Origin-Headers", usedOriginHeaders ? "1" : "0");
    failHeaders.set("X-Upstream-Redirected", usedRedirected ? "1" : "0");
    failHeaders.set("X-Upstream-Redirect-Cookie", usedRedirectCookie ? "1" : "0");
    failHeaders.set("X-Upstream-Failure-Class", usedFailureClass);
    if (redirectedVodDeadBases.size) failHeaders.set("X-Upstream-Dead-Media-Bases", Array.from(redirectedVodDeadBases).join(","));

    const errObj = lastError as { name?: string; message?: string; stack?: string } | null;
    const phase: string = usedFailureClass
      || (errObj?.name === "AbortError" ? "upstream-timeout"
        : errObj ? "fetch-exception"
        : lastStatus ? `upstream-${lastStatus}`
        : "no-attempt-succeeded");

    // Log obrigatório antes de qualquer falha — única forma de diagnosticar
    // sem Logcat / sem reproduzir no preview.
    console.error("[VOD PROXY FAIL]", JSON.stringify({
      phase,
      original_url: target,
      upstream_url: upstreamUrl.toString(),
      final_url: usedFinalUrl,
      last_status: lastStatus,
      redirect_location: usedRedirectLocation,
      direct_candidate: usedDirectCandidate,
      content_type_final: attemptTraces.at(-1)?.contentType ?? null,
      redirect_count: attemptTraces.filter((a) => a.redirected).length,
      failure_class: usedFailureClass,
      ua_last: usedUA,
      origin_headers_last: usedOriginHeaders,
      attempts_total: attemptTraces.length,
      exception_message: errObj?.message ?? null,
      exception_name: errObj?.name ?? null,
      exception_stack: errObj?.stack ?? null,
      attempts: attemptTraces,
    }));

    const clientStatus = lastStatus && lastStatus < 500 && (lastStatus < 200 || lastStatus >= 300) ? lastStatus : 502;
    const debugPhase = lastStatus ? `upstream-${lastStatus}` : phase;
    const debugReason = errObj
      ? (errObj.name === "AbortError" ? "upstream-timeout" : "fetch-exception")
      : lastStatus >= 500
        ? "upstream-server-error"
        : "no-upstream-response";
    failHeaders.set("Content-Type", "application/json; charset=utf-8");
    const failurePayload = {
      error: phase.startsWith("upstream-") || phase === "fetch-exception" || phase === "upstream-timeout"
        ? phase.toUpperCase().replace(/-/g, "_")
        : (usedFailureClass ? usedFailureClass.toUpperCase().replace(/-/g, "_") : "BAD_GATEWAY"),
      debug_phase: debugPhase,
      debug_reason: debugReason,
      debug_line: 829,
      phase,
      upstream_status: lastStatus || null,
      upstream_url: upstreamUrl.toString(),
      final_url: usedFinalUrl,
      content_type: attemptTraces.at(-1)?.contentType ?? null,
      redirects: attemptTraces.filter((a) => a.redirected).length,
      redirect_count: attemptTraces.filter((a) => a.redirected).length,
      redirect_location: usedRedirectLocation || null,
      direct_candidate: usedDirectCandidate || null,
      candidate: usedDirectCandidate || usedFinalUrl,
      failure_class: usedFailureClass || null,
      dead_media_bases: redirectedVodDeadBases.size ? Array.from(redirectedVodDeadBases) : null,
      ua_last: usedUA || null,
      exception: errObj ? { name: errObj.name, message: errObj.message } : null,
      exception_message: errObj?.message ?? null,
      exception_stack: errObj?.stack ?? null,
      attempts_total: attemptTraces.length,
      attempts: attemptTraces,
    } satisfies Debug502Payload;
    return debugJsonResponse(clientStatus, failurePayload, failHeaders);
  }

  const ct = upstream.headers.get("content-type") || "";
  const isPlaylist =
    /mpegurl/i.test(ct) ||
    /\.m3u8(\?|$)/i.test(upstreamUrl.pathname) ||
    /\.m3u(\?|$)/i.test(upstreamUrl.pathname);

  const respHeaders = new Headers(CORS);
  // Diagnóstico (lido pelo player no client p/ relatório de "Erro de reprodução")
  respHeaders.set("X-Upstream-Status", String(upstream.status));
  respHeaders.set("X-Upstream-Content-Type", ct || "");
  respHeaders.set("X-Upstream-Final-Url", usedFinalUrl);
  respHeaders.set("X-Upstream-Redirect-Location", usedRedirectLocation);
  respHeaders.set("X-Upstream-Direct-Candidate", usedDirectCandidate);
  respHeaders.set("X-Upstream-User-Agent", usedUA);
  respHeaders.set("X-Upstream-Origin-Headers", usedOriginHeaders ? "1" : "0");
  respHeaders.set("X-Upstream-Redirected", usedRedirected ? "1" : "0");
  respHeaders.set("X-Upstream-Redirect-Cookie", usedRedirectCookie ? "1" : "0");
  respHeaders.set("X-Upstream-Failure-Class", usedFailureClass);
  if (redirectedVodDeadBases.size) respHeaders.set("X-Upstream-Dead-Media-Bases", Array.from(redirectedVodDeadBases).join(","));
  if (!upstream.ok) {
    if (upstream.status === 502) {
      try { await upstream.body?.cancel(); } catch { /* noop */ }
      return debugJsonResponse(502, {
        error: "UPSTREAM_502",
        debug_phase: "upstream-non-ok",
        debug_reason: "upstream-returned-502",
        debug_line: 886,
        phase: "upstream-502",
        failure_class: usedFailureClass || "upstream-502",
        exception_message: null,
        exception_stack: null,
        upstream_status: upstream.status,
        upstream_url: upstreamUrl.toString(),
        final_url: usedFinalUrl,
        redirects: usedRedirected ? 1 : 0,
        redirect_count: usedRedirected ? 1 : 0,
        content_type: ct || null,
        candidate: usedDirectCandidate || usedFinalUrl || upstreamUrl.toString(),
        ua_last: usedUA || null,
      }, respHeaders);
    }
    if (isVod) {
      if (isDiagProbe) {
        try { await upstream.body?.cancel(); } catch { /* noop */ }
        return new Response(null, { status: upstream.status, headers: respHeaders });
      }
      // FIX D7 (audit IPTV): antes retornávamos 200+JSON em erro VOD, o que
      // fazia o player decodificar JSON como vídeo → MediaError code=4 sem
      // mensagem útil. Agora propagamos o status HTTP real (404/403/503/…)
      // para o player acionar tryNextVod() pela via normal de erro de rede.
      // Mantemos o corpo JSON para diagnóstico em logs.
      return Response.json(
        { error: `UPSTREAM_${upstream.status}`, fallback: true },
        { status: upstream.status, headers: respHeaders },
      );
    }
    respHeaders.set("Content-Type", contentTypeForPath(upstreamUrl.pathname));
    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  }

  // forward useful headers
  for (const h of ["content-length", "content-range", "accept-ranges", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }

  if (isPlaylist && upstream.ok) {
    if (request.method === "HEAD" && !vodContext && !isDiagProbe) {
      respHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
      return new Response(null, { status: upstream.status, headers: respHeaders });
    }
    const text = await upstream.text();
    const trimmed = text.trim();
    // VOD HLS em alguns painéis responde HEAD 200/content-length 0, mas o GET
    // real vem vazio/HTML/404 no CDN final. Não entregue manifesto vazio como
    // 200, senão o hls.js acusa apenas manifestLoadError sem causa útil.
    if (vodContext && (!trimmed || !trimmed.includes("#EXTM3U"))) {
      respHeaders.delete("content-length");
      try { await upstream.body?.cancel(); } catch { /* noop */ }
      return debugJsonResponse(502, {
        error: trimmed ? "INVALID_VOD_HLS_MANIFEST" : "EMPTY_VOD_HLS_MANIFEST",
        debug_phase: "vod-hls-manifest-validation",
        debug_reason: trimmed ? "invalid-manifest" : "empty-manifest",
        debug_line: 921,
        phase: "vod-hls-manifest-validation",
        failure_class: trimmed ? "invalid-vod-hls-manifest" : "empty-vod-hls-manifest",
        exception_message: trimmed ? "invalid VOD HLS manifest" : "empty VOD HLS manifest",
        exception_stack: null,
        upstream_status: upstream.status,
        upstream_url: upstreamUrl.toString(),
        final_url: usedFinalUrl,
        redirects: usedRedirected ? 1 : 0,
        redirect_count: usedRedirected ? 1 : 0,
        content_type: ct || null,
        candidate: usedDirectCandidate || usedFinalUrl || upstreamUrl.toString(),
      }, respHeaders);
    }
    const rewritten = rewritePlaylist(text, upstream.url || upstreamUrl.toString(), usedUA || forcedUA, vodContext ? "vod" : undefined);
    respHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
    respHeaders.delete("content-length");
    return new Response(isDiagProbe ? null : rewritten, { status: upstream.status, headers: respHeaders });
  }

  // VOD / segmentos: deduzir Content-Type pelo path quando o upstream manda
  // algo inútil tipo application/octet-stream (faz o browser baixar em vez de tocar).
  const path = upstreamUrl.pathname.toLowerCase();
  let finalCt = ct;
  const badCt = !ct || /octet-stream|binary|text\/plain/i.test(ct);
  if (badCt) {
    finalCt = contentTypeForPath(path);
  }
  respHeaders.set("Content-Type", finalCt);
  if (!respHeaders.has("accept-ranges")) respHeaders.set("Accept-Ranges", "bytes");
  let status = upstream.status;
  const requestedRange = request.headers.get("range");
  const contentLength = respHeaders.get("content-length");
  if (isVod && status === 206 && effectiveVodRange) {
    normalizeVodRangeResponseHeaders(respHeaders, effectiveVodRange);
    if (isDiagProbe) {
      try { await upstream.body?.cancel(); } catch { /* noop */ }
    }
    return new Response(request.method === "HEAD" || isDiagProbe ? null : upstream.body, { status, headers: respHeaders });
  }
  if (isVod && status === 200 && requestedRange) {
    const parsed = parseByteRange(requestedRange);
    const total = numericHeader(upstream.headers, "content-length");
    if (parsed && total !== undefined && parsed.start < total) {
      const start = parsed.start;
      const end = Math.min(parsed.end ?? total - 1, total - 1);
      const len = end - start + 1;
      respHeaders.set("Content-Length", String(len));
      respHeaders.set("Content-Range", `bytes ${start}-${end}/${total}`);
      respHeaders.set("Accept-Ranges", "bytes");
      if (isDiagProbe) {
        try { await upstream.body?.cancel(); } catch { /* noop */ }
      }
      const body = request.method === "HEAD" || isDiagProbe
        ? null
        : start === 0 && len === total
          ? upstream.body
          : sliceReadableStream(upstream.body, start, len);
      return new Response(body, { status: 206, headers: respHeaders });
    }
  }
  // FIX WEB-LIVE: NÃO converter 200→206 em LIVE .ts. mpegts.js no navegador
  // desktop fetcha o stream esperando entrega contínua (Transfer-Encoding:
  // chunked / open-ended). Se forçarmos 206 + Content-Range finito, ele
  // assume "arquivo de N bytes", para de ler quando atinge N e dispara
  // ERROR sem ter recebido frame algum (causa do bug "buffer starvation"
  // no relatório). Mantemos o ajuste só para fluxos que NÃO sejam .ts live.
  const isLiveTs = /\.ts(\?|$)/i.test(upstreamUrl.pathname) && !isVod;
  if (
    requestedRange?.trim().toLowerCase() === "bytes=0-" &&
    !isVod && !isLiveTs && status === 200 && contentLength
  ) {
    const total = Number(contentLength);
    if (Number.isFinite(total) && total > 0) {
      status = 206;
      respHeaders.set("Content-Range", `bytes 0-${total - 1}/${total}`);
    }
  }
  if (isDiagProbe) {
    try { await upstream.body?.cancel(); } catch { /* noop */ }
  }
  return new Response(request.method === "HEAD" || isDiagProbe ? null : upstream.body, { status, headers: respHeaders });
}

async function safeHandle(request: Request): Promise<Response> {
  let phase = "handler-entry";
  let kind: "vod" | "live" | "unknown" = "unknown";
  let probe = false;
  let url = "";
  try {
    url = request.url;
    try {
      const u = new URL(request.url);
      const target = u.searchParams.get("u") || "";
      probe = u.searchParams.get("probe") === "1";
      kind = u.searchParams.get("kind") === "vod" ? "vod" : (target && isVodPath(new URL(target).pathname) ? "vod" : "live");
    } catch { /* noop */ }
    phase = "handle";
    return await handle(request);
  } catch (e) {
    const err = e as { name?: string; message?: string; stack?: string } | null;
    // Log obrigatório — esta é a falha INTERNA do proxy (não respondeu nada
    // de upstream). Sem isso o browser só vê 502 HTML genérico do worker.
    console.error("[API_STREAM_FATAL]", {
      phase,
      url,
      error: err?.message,
      stack: err?.stack,
      name: err?.name,
      kind,
      probe,
    });
    const headers = new Headers(CORS);
    headers.set("X-Upstream-Status", "0");
    headers.set("X-Upstream-Final-Url", "");
    headers.set("X-Upstream-Failure-Class", "internal-proxy-failure");
    return debugJsonResponse(502, {
      error: "INTERNAL_PROXY_FAILURE",
      debug_phase: "safe-handle-catch",
      debug_reason: "unhandled-exception",
      debug_line: 1026,
      phase: "internal-proxy-failure",
      upstream_status: null,
      upstream_url: null,
      final_url: null,
      redirects: 0,
      redirect_count: 0,
      content_type: null,
      candidate: null,
      failure_class: "internal-proxy-failure",
      handler_phase: phase,
      request_url: url,
      kind,
      probe,
      exception: err ? { name: err.name, message: err.message } : null,
      exception_message: err?.message ?? null,
      exception_name: err?.name ?? null,
      exception_stack: err?.stack ?? null,
    }, headers);
  }
}

export const Route = createFileRoute("/api/stream")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => safeHandle(request),
      HEAD: async ({ request }) => safeHandle(request),
    },
  },
});

