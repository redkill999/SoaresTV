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
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Upstream-Status, X-Upstream-Content-Type, X-Upstream-Final-Url, X-Upstream-User-Agent, X-Upstream-Origin-Headers, X-Upstream-Redirected",
};

function proxyUrl(absolute: string, ua?: string | null) {
  const uaPart = ua ? `&ua=${encodeURIComponent(ua)}` : "";
  return `/api/stream?u=${encodeURIComponent(absolute)}&v=6${uaPart}`;
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
  const parsed = parseByteRange(requestedRange);
  // VOD precisa se comportar como servidor de arquivo progressivo. Antes o
  // proxy capava toda Range em blocos de 16MB; alguns navegadores/players do
  // preview interpretavam isso como fim prematuro do arquivo e abortavam filmes.
  // Agora repassamos a Range exata do browser. Sem Range, pedimos open-ended.
  return parsed ? requestedRange!.trim() : "bytes=0-";
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

function rewritePlaylist(text: string, baseUrl: string, ua?: string | null): string {
  const base = new URL(baseUrl);
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      // URI="..." attributes (EXT-X-KEY, EXT-X-MAP, etc.)
      const withUri = line.replace(/URI="([^"]+)"/g, (_, uri) => {
        try {
          return `URI="${proxyUrl(new URL(uri, base).toString(), ua)}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
      if (withUri.startsWith("#")) return withUri;
      // bare URL line (segment / sub-playlist)
      try {
        return proxyUrl(new URL(withUri, base).toString(), ua);
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
  const isVod = !playlistPath && (url.searchParams.get("kind") === "vod" || isVodPath(upstreamUrl.pathname));
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ...DEFAULT_UAS,
  ];
  const forcedUA = url.searchParams.get("ua");
  const UA_CANDIDATES = forcedUA
    ? Array.from(new Set([forcedUA, ...(isVod ? VOD_UAS : DEFAULT_UAS)]))
    : (isVod ? Array.from(new Set(VOD_UAS)) : DEFAULT_UAS);


  const buildHeaders = (ua: string, rangeValue: string | null, originHeaderMode: "none" | "referer" | "origin") => {
    const h = new Headers();
    h.set("User-Agent", ua);
    h.set("Accept", isVod ? "video/*,*/*;q=0.9" : "*/*");
    h.set("Accept-Encoding", "identity");
    h.set("Icy-MetaData", "0");
    if (originHeaderMode === "referer" || originHeaderMode === "origin") {
      h.set("Referer", `${upstreamUrl.origin}/`);
    }
    if (originHeaderMode === "origin") {
      h.set("Origin", upstreamUrl.origin);
    }
    if (rangeValue) h.set("Range", rangeValue);
    return h;
  };

  let upstream: Response | null = null;
  let lastError: unknown = null;
  let lastStatus = 0;
  // Diagnóstico: registra qual UA / header set / URL final realmente respondeu
  // (independente de 2xx). Vai como X-Upstream-* na resposta pro client logar.
  let usedUA = "";
  let usedOriginHeaders = false;
  let usedFinalUrl = upstreamUrl.toString();
  let usedRedirected = false;
  const rangeCandidates = isVod
    ? Array.from(new Set([effectiveVodRange, range, "bytes=0-", null]))
    : playlistPath
      ? [range]
      : Array.from(new Set([range, "bytes=0-", null]));
  const originHeaderModes: OriginHeaderMode[] = isVod
    ? ["none", "referer", "origin"]
    : ["none", "origin"];
  const attemptPlans: UpstreamAttempt[] = isVod
    ? uniqueAttempts([
        // VOD web: primeiro testa TODOS os UAs com a combinação mais comum.
        // Antes, 404 falso em UA desktop consumia o limite e nunca chegava em
        // XCIPTV/TiviMate/Smarters, quebrando filmes/séries no preview.
        ...UA_CANDIDATES.map((ua) => ({ ua, rangeValue: effectiveVodRange, originHeaderMode: "none" as const })),
        ...UA_CANDIDATES.map((ua) => ({ ua, rangeValue: null, originHeaderMode: "none" as const })),
        ...UA_CANDIDATES.map((ua) => ({ ua, rangeValue: effectiveVodRange, originHeaderMode: "referer" as const })),
        ...UA_CANDIDATES.map((ua) => ({ ua, rangeValue: null, originHeaderMode: "referer" as const })),
        ...UA_CANDIDATES.map((ua) => ({ ua, rangeValue: effectiveVodRange, originHeaderMode: "origin" as const })),
        ...UA_CANDIDATES.map((ua) => ({ ua, rangeValue: range, originHeaderMode: "none" as const })),
      ])
    : uniqueAttempts(UA_CANDIDATES.flatMap((ua) =>
        rangeCandidates.flatMap((rangeValue) =>
          originHeaderModes.map((originHeaderMode) => ({ ua, rangeValue, originHeaderMode })),
        ),
      ));
  attempt: for (const { ua, rangeValue, originHeaderMode } of attemptPlans) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), isVod ? 8_000 : 20_000);
          let res: Response;
          try {
            res = await fetch(upstreamUrl.toString(), {
              method: request.method === "HEAD" && !isVod ? "HEAD" : "GET",
              headers: buildHeaders(ua, rangeValue, originHeaderMode),
              redirect: "follow",
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timeout);
          }
          lastStatus = res.status;
          usedUA = ua;
          usedOriginHeaders = originHeaderMode !== "none";
          usedFinalUrl = res.url || upstreamUrl.toString();
          usedRedirected = !!res.redirected || usedFinalUrl !== upstreamUrl.toString();
          const upstreamCt = res.headers.get("content-type") || "";
          const retryBlocked = res.status === 401 || res.status === 403;
          const retryBadRange = isVod && !!rangeValue && (res.status === 400 || res.status === 416);
          // Alguns CDNs IPTV de VOD retornam 404 falso quando recebem Range,
          // Referer ausente ou User-Agent de player. Antes aceitávamos esse
          // primeiro 404 e o filme/série morria no preview web. Para VOD, 404
          // vira tentativa de compatibilidade: testa sem Range, com Referer e
          // com UA de navegador desktop antes de concluir que é inexistente.
          const retryVodCompat404 = isVod && res.status === 404;
          // Alguns CDNs retornam 200 com página HTML/JSON de bloqueio em vez
          // de vídeo. Se aceitarmos esse 200, o <video> falha com code=4 e não
          // tentamos o próximo UA. Para VOD, HTML/JSON/XML nunca é mídia válida.
          const retryVodBadContent = isVod && res.ok && isLikelyVodBlockContentType(upstreamCt);
          if (!retryBlocked && !retryBadRange && !retryVodCompat404 && !retryVodBadContent) {
            upstream = res;
            break attempt;
          }
          try { await res.body?.cancel(); } catch { /* noop */ }
        } catch (e) {
          lastError = e;
        }
  }
  if (!upstream) {
    const failHeaders = new Headers(CORS);
    failHeaders.set("X-Upstream-Status", String(lastStatus || 0));
    failHeaders.set("X-Upstream-Final-Url", usedFinalUrl || upstreamUrl.toString());
    failHeaders.set("X-Upstream-User-Agent", usedUA || (forcedUA ?? ""));
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
  respHeaders.set("X-Upstream-User-Agent", usedUA);
  respHeaders.set("X-Upstream-Origin-Headers", usedOriginHeaders ? "1" : "0");
  respHeaders.set("X-Upstream-Redirected", usedRedirected ? "1" : "0");
  if (!upstream.ok) {
    if (isVod) {
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
    if (request.method === "HEAD") {
      respHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
      return new Response(null, { status: upstream.status, headers: respHeaders });
    }
    const text = await upstream.text();
    const rewritten = rewritePlaylist(text, upstream.url || upstreamUrl.toString(), forcedUA);
    respHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
    respHeaders.delete("content-length");
    return new Response(rewritten, { status: upstream.status, headers: respHeaders });
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
    return new Response(request.method === "HEAD" ? null : upstream.body, { status, headers: respHeaders });
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
      const body = request.method === "HEAD"
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
  return new Response(request.method === "HEAD" ? null : upstream.body, { status, headers: respHeaders });
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
