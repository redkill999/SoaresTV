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
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type, Location, X-Upstream-Status, X-Upstream-Content-Type, X-Upstream-Final-Url, X-Upstream-Redirect-Location, X-Upstream-Direct-Candidate, X-Upstream-User-Agent, X-Upstream-Origin-Headers, X-Upstream-Redirected, X-Upstream-Redirect-Cookie, X-Upstream-Failure-Class, X-Upstream-Dead-Media-Bases, X-Stream-Redirect-Mode",
};

const VOD_CHUNK_SIZE = 16 * 1024 * 1024;

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
type UpstreamAttempt = { ua: string; rangeValue: string | null; originHeaderMode: OriginHeaderMode };

function uniqueAttempts(attempts: UpstreamAttempt[]): UpstreamAttempt[] {
  const seen = new Set<string>();
  const out: UpstreamAttempt[] = [];
  for (const attempt of attempts) {
    const key = `${attempt.ua}\n${attempt.rangeValue ?? ""}\n${attempt.originHeaderMode}`;
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
  const rangeCandidates = isVod
    ? Array.from(new Set([effectiveVodRange, finiteVodRangeForUpstream(effectiveVodRange), range, "bytes=0-", null]))
    : playlistPath
      ? [range]
      : Array.from(new Set([range, "bytes=0-", null]));
  const originHeaderModes: OriginHeaderMode[] = vodContext
    ? ["none", "referer", "origin"]
    : ["none", "origin"];
  const attemptPlans: UpstreamAttempt[] = isVod
    ? uniqueAttempts(UA_CANDIDATES.flatMap((ua) => [
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
      ]))
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

  attempt: for (const { ua, rangeValue, originHeaderMode } of attemptPlans) {
        try {
          const controller = new AbortController();
          // VOD pode demorar para o CDN entregar o primeiro byte no preview;
          // porém probes/manifestos de VOD precisam falhar rápido para não
          // deixar o <video>/hls.js preso em CDNs que retornam HEAD 200 vazio
          // e GET 404 (caso suportejetflix.site → flixbr.lat).
          const timeout = setTimeout(() => controller.abort(), isDiagProbe || playlistPath ? 7_000 : 20_000);
          let res: Response;
          let resolvedRedirectManually = false;
          try {
            const upstreamMethod = (request.method === "HEAD" || isDiagProbe) && vodContext ? "GET" : request.method === "HEAD" ? "HEAD" : "GET";
            if (vodContext && upstreamMethod === "GET") {
              const first = await fetch(upstreamUrl.toString(), {
                method: "GET",
                headers: buildHeaders(ua, rangeValue, originHeaderMode),
                redirect: "manual",
                signal: controller.signal,
              });
              const loc = resolveLocation(first.headers.get("location"), upstreamUrl);
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
          if (vodContext && res.status === 404 && usedRedirected) {
            redirectedVod404Count += 1;
            if (isLikelyVodBlockContentType(upstreamCt)) {
              redirectedVod404HtmlCount += 1;
              const deadBase = mediaIdentityKey(usedFinalUrl);
              if (deadBase) redirectedVodDeadBases.add(deadBase);
            }
          }
          // Probe diagnóstico: não varre dezenas de combinações. A primeira
          // resposta real já é a informação que precisamos exibir no painel
          // (status, URL final, UA e headers), e evita "signal aborted" vazio.
          if (isDiagProbe) {
            upstream = res;
            break attempt;
          }
          // Alguns CDNs IPTV de VOD retornam 404 falso quando recebem Range,
          // Referer ausente ou User-Agent de player. Antes aceitávamos esse
          // primeiro 404 e o filme/série morria no preview web. Para VOD, 404
          // vira tentativa de compatibilidade: testa sem Range, com Referer e
          // com UA de navegador desktop antes de concluir que é inexistente.
          // Alguns CDNs retornam 200 com página HTML/JSON de bloqueio em vez
          // de vídeo. Se aceitarmos esse 200, o <video> falha com code=4 e não
          // tentamos o próximo UA. Para VOD, HTML/JSON/XML nunca é mídia válida.
          if (!shouldRetryVodResponse(res, rangeValue, usedRedirected, upstreamCt, usedFinalUrl)) {
            upstream = res;
            break attempt;
          }
          try { await res.body?.cancel(); } catch { /* noop */ }
        } catch (e) {
          lastError = e;
          if (isDiagProbe) {
            usedUA = ua;
            usedOriginHeaders = originHeaderMode !== "none";
            usedFailureClass = (e as { name?: string } | null)?.name === "AbortError" ? "probe-timeout" : "probe-network-error";
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
    const clientStatus = lastStatus && lastStatus < 500 && (lastStatus < 200 || lastStatus >= 300) ? lastStatus : 502;
    return new Response(`upstream fetch failed${lastStatus ? ` HTTP ${lastStatus}` : ""}: ${lastError instanceof Error ? lastError.message : "err"}`, {
      status: clientStatus,
      headers: failHeaders,
    });
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
      respHeaders.set("Content-Type", "text/plain; charset=utf-8");
      respHeaders.delete("content-length");
      try { await upstream.body?.cancel(); } catch { /* noop */ }
      return new Response(trimmed ? "invalid VOD HLS manifest" : "empty VOD HLS manifest", { status: 502, headers: respHeaders });
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

export const Route = createFileRoute("/api/stream")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
      HEAD: async ({ request }) => handle(request),
    },
  },
});
