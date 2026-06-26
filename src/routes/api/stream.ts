import { createFileRoute } from "@tanstack/react-router";

// Proxy upstream IPTV streams so the browser doesn't hit CORS / mixed-content
// issues. For HLS playlists (.m3u8 / mpegurl) we rewrite the segment URLs so
// they also flow through this proxy.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type, Accept, Origin, Referer, User-Agent",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
};

const VOD_CHUNK_SIZE = 16 * 1024 * 1024;

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
  const cappedEnd = Math.min(parsed.end ?? parsed.start + VOD_CHUNK_SIZE - 1, parsed.start + VOD_CHUNK_SIZE - 1);
  return `bytes=${parsed.start}-${cappedEnd}`;
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
  // LIVE: muitos painéis IPTV (Xtream) retornam 403 quando recebem qualquer
  // header Range em streams .ts ao vivo. O proxy NUNCA deve injetar Range em
  // LIVE — só repassa quando o cliente explicitamente pediu (raro em live).
  const isLive =
    !playlistPath && !isVod &&
    (url.searchParams.get("kind") === "live" || /\/live\//i.test(upstreamUrl.pathname));
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
  const forcedUA = url.searchParams.get("ua");
  const UA_CANDIDATES = forcedUA
    ? Array.from(new Set([forcedUA, ...DEFAULT_UAS]))
    : DEFAULT_UAS;


  const buildHeaders = (ua: string, rangeValue: string | null, includeOriginHeaders: boolean) => {
    const h = new Headers();
    h.set("User-Agent", ua);
    h.set("Accept", "*/*");
    h.set("Accept-Encoding", "identity");
    h.set("Icy-MetaData", "0");
    if (includeOriginHeaders) {
      h.set("Referer", `${upstreamUrl.origin}/`);
      h.set("Origin", upstreamUrl.origin);
    }
    if (rangeValue) h.set("Range", rangeValue);
    return h;
  };

  let upstream: Response | null = null;
  let lastError: unknown = null;
  let lastStatus = 0;
  const rangeCandidates = isVod
    ? Array.from(new Set([effectiveVodRange, range, null]))
    : playlistPath
      ? [range]
      : isLive
        // LIVE: NUNCA mandar Range — gera 403 em painéis Xtream para .ts ao vivo.
        ? [null]
        : Array.from(new Set([range, "bytes=0-", null]));
  attempt: for (const ua of UA_CANDIDATES) {
    for (const rangeValue of rangeCandidates) {
      for (const includeOriginHeaders of [false, true]) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 20_000);
          const res = await fetch(upstreamUrl.toString(), {
            method: request.method === "HEAD" && !isVod ? "HEAD" : "GET",
            headers: buildHeaders(ua, rangeValue, includeOriginHeaders),
            redirect: "follow",
            signal: controller.signal,
          });
          clearTimeout(timeout);
          lastStatus = res.status;
          const retryBlocked = res.status === 401 || res.status === 403;
          const retryBadRange = isVod && !!rangeValue && (res.status === 400 || res.status === 416);
          if (!retryBlocked && !retryBadRange) {
            upstream = res;
            break attempt;
          }
          try { await res.body?.cancel(); } catch { /* noop */ }
        } catch (e) {
          lastError = e;
        }
      }
    }
  }
  if (!upstream) {
    return new Response(`upstream fetch failed${lastStatus ? ` HTTP ${lastStatus}` : ""}: ${lastError instanceof Error ? lastError.message : "err"}`, {
      status: lastStatus === 401 || lastStatus === 403 ? lastStatus : 502,
      headers: CORS,
    });
  }

  const ct = upstream.headers.get("content-type") || "";
  const isPlaylist =
    /mpegurl/i.test(ct) ||
    /\.m3u8(\?|$)/i.test(upstreamUrl.pathname) ||
    /\.m3u(\?|$)/i.test(upstreamUrl.pathname);

  const respHeaders = new Headers(CORS);
  if (!upstream.ok) {
    if (isVod) {
      return Response.json(
        { error: `UPSTREAM_${upstream.status}`, fallback: true },
        { status: 200, headers: respHeaders },
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
  if (requestedRange?.trim().toLowerCase() === "bytes=0-" && !isVod && status === 200 && contentLength) {
    const total = Number(contentLength);
    if (Number.isFinite(total) && total > 0) {
      status = 206;
      respHeaders.set("Content-Range", `bytes 0-${total - 1}/${total}`);
    }
  }
  return new Response(upstream.body, { status, headers: respHeaders });
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
