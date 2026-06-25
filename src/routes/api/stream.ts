import { createFileRoute } from "@tanstack/react-router";

// Proxy IPTV minimalista (reescrito na Fase 2 da reversão).
//
// Responsabilidades:
//   1. Encaminhar a requisição ao upstream preservando Range/UA/Referer.
//   2. Para playlists HLS (.m3u8): reescrever segmentos para também fluírem
//      pelo proxy (resolve CORS / mixed-content no preview HTTPS).
//   3. Tratar redirects (redirect: "follow" — não fazemos waterfall manual).
//   4. Em caso de falha, retornar SEMPRE JSON estruturado (nunca HTML).
//
// Não-objetivos (removidos da versão anterior):
//   - probes (?probe=1), peeks (?redirect=peek)
//   - matriz UA × Origin × Referer × Cookie × Range
//   - normalização 5xx → 424
//   - headers X-Upstream-* / X-Debug-*
//   - slicing manual de Range para forçar 206

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type, Accept, Origin, Referer, User-Agent",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
};

// Lista curta de UAs IPTV-friendly. A maioria dos painéis aceita ao menos um destes.
const DEFAULT_UA_CYCLE = [
  "VLC/3.0.20 LibVLC/3.0.20",
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36",
  "IPTV Smarters Pro/4.0",
  "okhttp/4.12.0",
];

// Para VOD via navegador desktop, começamos com UA de browser real porque
// muitos CDNs Xtream liberam VOD para Chrome/Firefox e bloqueiam UAs IPTV
// vindos de IP de datacenter.
const VOD_UA_CYCLE = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "VLC/3.0.20 LibVLC/3.0.20",
  "IPTV Smarters Pro/4.0",
  "okhttp/4.12.0",
];

function isPlaylistPath(path: string): boolean {
  return /\.m3u8?(\?|$)/i.test(path);
}

function proxyUrl(absolute: string, ua?: string | null, kind?: "live" | "vod"): string {
  const kindPart = kind === "vod" ? "&kind=vod" : "";
  const uaPart = ua ? `&ua=${encodeURIComponent(ua)}` : "";
  return `/api/stream?u=${encodeURIComponent(absolute)}${kindPart}&v=7${uaPart}`;
}

function rewritePlaylist(text: string, baseUrl: string, ua: string | null, kind: "live" | "vod"): string {
  const base = new URL(baseUrl);
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      const withUri = line.replace(/URI="([^"]+)"/g, (_, uri: string) => {
        try { return `URI="${proxyUrl(new URL(uri, base).toString(), ua, kind)}"`; }
        catch { return `URI="${uri}"`; }
      });
      if (withUri.startsWith("#")) return withUri;
      try { return proxyUrl(new URL(withUri, base).toString(), ua, kind); }
      catch { return withUri; }
    })
    .join("\n");
}

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  const headers = new Headers(CORS);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ error, status, ...extra }), { status, headers });
}

function buildHeaders(target: URL, ua: string, range: string | null): Headers {
  const h = new Headers();
  h.set("User-Agent", ua);
  h.set("Accept", isPlaylistPath(target.pathname)
    ? "application/vnd.apple.mpegurl,application/x-mpegURL,*/*;q=0.8"
    : "*/*");
  h.set("Accept-Language", "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7");
  h.set("Accept-Encoding", "identity");
  h.set("Icy-MetaData", "0");
  // Alguns painéis Xtream validam Referer da origem.
  h.set("Referer", `${target.origin}/`);
  if (range) h.set("Range", range);
  return h;
}

async function tryFetch(target: URL, ua: string, range: string | null, method: "GET" | "HEAD"): Promise<Response> {
  const headers = buildHeaders(target, ua, range);
  // IMPORTANTE: o AbortSignal passado a fetch() aborta TAMBÉM o corpo da
  // resposta após o timeout. Para um stream LIVE/.ts ou um download de filme,
  // isso matava a reprodução em ~25s. Usamos um controller manual e cancelamos
  // o timeout assim que recebemos os headers — a partir daí o body flui livre.
  const controller = new AbortController();
  const handshakeTimer = setTimeout(() => controller.abort(), 25_000);
  try {
    return await fetch(target.toString(), {
      method,
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(handshakeTimer);
  }
}

async function handle(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonError(405, "method not allowed");
  }

  const url = new URL(request.url);
  const targetRaw = url.searchParams.get("u");
  if (!targetRaw) return jsonError(400, "missing ?u");

  let target: URL;
  try { target = new URL(targetRaw); }
  catch { return jsonError(400, "invalid target url"); }
  if (!/^https?:$/.test(target.protocol)) return jsonError(400, "bad protocol");

  const kind: "live" | "vod" = url.searchParams.get("kind") === "vod" ? "vod" : "live";
  const forcedUA = url.searchParams.get("ua");
  const range = request.headers.get("range");

  const uaCycle = forcedUA
    ? Array.from(new Set([forcedUA, ...(kind === "vod" ? VOD_UA_CYCLE : DEFAULT_UA_CYCLE)]))
    : (kind === "vod" ? VOD_UA_CYCLE : DEFAULT_UA_CYCLE);

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (const ua of uaCycle) {
    try {
      const res = await tryFetch(target, ua, range, request.method as "GET" | "HEAD");
      // 401/403 → tenta próximo UA; resto entrega ao cliente.
      if (res.status === 401 || res.status === 403) {
        lastResponse = res;
        continue;
      }

      const upstreamContentType = res.headers.get("content-type") ?? "";
      const isHls = isPlaylistPath(target.pathname) || /mpegurl/i.test(upstreamContentType);

      // HLS playlist → reescreve.
      if (isHls && res.ok && request.method === "GET") {
        const text = await res.text();
        const finalUrl = res.url || target.toString();
        const rewritten = rewritePlaylist(text, finalUrl, forcedUA, kind);
        const headers = new Headers(CORS);
        headers.set("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        headers.set("Cache-Control", "no-store");
        return new Response(rewritten, { status: 200, headers });
      }

      // Stream passthrough.
      const outHeaders = new Headers();
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
        const v = res.headers.get(name);
        if (v) outHeaders.set(name, v);
      }
      for (const [k, v] of Object.entries(CORS)) outHeaders.set(k, v);
      if (!outHeaders.has("accept-ranges")) outHeaders.set("Accept-Ranges", "bytes");

      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: outHeaders });
    } catch (err) {
      lastError = err;
      // Continua tentando próximo UA em erro de rede/timeout.
      continue;
    }
  }

  if (lastResponse) {
    // Todos os UAs caíram em 401/403 — devolve o último com headers de CORS.
    const out = new Headers(lastResponse.headers);
    for (const [k, v] of Object.entries(CORS)) out.set(k, v);
    return new Response(lastResponse.body, { status: lastResponse.status, statusText: lastResponse.statusText, headers: out });
  }

  return jsonError(502, "upstream unreachable", {
    target: target.toString(),
    reason: lastError instanceof Error ? lastError.message : String(lastError ?? "unknown"),
  });
}

export const Route = createFileRoute("/api/stream")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      HEAD: ({ request }) => handle(request),
      OPTIONS: ({ request }) => handle(request),
    },
  },
});
