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

const VOD_CHUNK_SIZE = 2 * 1024 * 1024;

function proxyUrl(absolute: string) {
  return `/api/stream?u=${encodeURIComponent(absolute)}`;
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

function vodRangeForUpstream(requestedRange: string | null): string {
  const parsed = parseByteRange(requestedRange) ?? { start: 0 };
  const cappedEnd = Math.min(parsed.end ?? parsed.start + VOD_CHUNK_SIZE - 1, parsed.start + VOD_CHUNK_SIZE - 1);
  return `bytes=${parsed.start}-${cappedEnd}`;
}

function limitBody(body: ReadableStream<Uint8Array> | null, bytes: number) {
  if (!body) return body;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      let sent = 0;
      try {
        while (sent < bytes) {
          const { done, value } = await reader.read();
          if (done) break;
          const remaining = bytes - sent;
          if (value.byteLength <= remaining) {
            controller.enqueue(value);
            sent += value.byteLength;
          } else {
            controller.enqueue(value.slice(0, remaining));
            sent += remaining;
            await reader.cancel().catch(() => undefined);
            break;
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function rewritePlaylist(text: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      // URI="..." attributes (EXT-X-KEY, EXT-X-MAP, etc.)
      const withUri = line.replace(/URI="([^"]+)"/g, (_, uri) => {
        try {
          return `URI="${proxyUrl(new URL(uri, base).toString())}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
      if (withUri.startsWith("#")) return withUri;
      // bare URL line (segment / sub-playlist)
      try {
        return proxyUrl(new URL(withUri, base).toString());
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

  const headers = new Headers();
  headers.set("User-Agent", "VLC/3.0.20 LibVLC/3.0.20");
  headers.set("Accept", "*/*");
  headers.set("Icy-MetaData", "0");
  const range = request.headers.get("range");
  const isVod = url.searchParams.get("kind") === "vod" || isVodPath(upstreamUrl.pathname);
  if (isVod) headers.set("Range", vodRangeForUpstream(range));
  else if (range) headers.set("Range", range);

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl.toString(), {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers,
      redirect: "follow",
    });
  } catch (e) {
    return new Response(`upstream fetch failed: ${e instanceof Error ? e.message : "err"}`, {
      status: 502,
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
    const rewritten = rewritePlaylist(text, upstream.url || upstreamUrl.toString());
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
  if (isVod && (status === 200 || status === 206)) {
    const parsed = parseByteRange(vodRangeForUpstream(range)) ?? { start: 0, end: VOD_CHUNK_SIZE - 1 };
    const requestedLength = Math.max(0, (parsed.end ?? parsed.start + VOD_CHUNK_SIZE - 1) - parsed.start + 1);
    const upstreamLength = contentLength && Number.isFinite(Number(contentLength)) ? Number(contentLength) : undefined;
    const bodyLength = Math.min(upstreamLength ?? requestedLength, requestedLength);
    const total = parseContentRangeTotal(respHeaders.get("content-range")) ?? (status === 200 ? upstreamLength : undefined);
    respHeaders.set("Content-Length", String(bodyLength));
    respHeaders.set("Content-Range", `bytes ${parsed.start}-${parsed.start + bodyLength - 1}/${total ?? "*"}`);
    status = 206;
    return new Response(request.method === "HEAD" ? null : limitBody(upstream.body, bodyLength), { status, headers: respHeaders });
  }
  if (requestedRange?.trim().toLowerCase() === "bytes=0-" && status === 200 && contentLength) {
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
