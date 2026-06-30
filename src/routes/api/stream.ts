import { createFileRoute } from "@tanstack/react-router";

// Proxy upstream IPTV streams so the browser doesn't hit CORS / mixed-content
// issues. LIVE keeps the playlist-rewrite + Range-strip path. VOD uses a
// simple fast-path: cycle a short UA list, follow redirects, pass-through
// the client's Range header and the upstream status/headers verbatim.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type, Accept, Origin, Referer, User-Agent",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
};

const UA_LIST = [
  "VLC/3.0.20 LibVLC/3.0.20",
  "XCIPTV/7.0 (Linux; Android 13)",
  "TiviMate/5.1.0",
  "IPTV Smarters Pro/4.0",
  "okhttp/4.12.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

// Padrões que indicam recusa de autenticação devolvida como corpo (em vez de
// 401/403 HTTP). Painéis Xtream tipicamente devolvem 200 + texto.
const AUTH_FAIL_RE = /UnauthorizedUser|Invalid\s+username|Invalid\s+password|User\s+expired|Account\s+expired|max\s+connections|Banned|forbidden/i;

function maskUrlForLog(u: string): string {
  return u
    .replace(/(\/(?:live|movie|series)\/)([^/]+)\/([^/]+)(\/)/i, "$1***USER***/***PASS***$4")
    .replace(/([?&](?:username|password)=)[^&]+/gi, "$1***");
}

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

function isPlaylistPath(path: string): boolean {
  return /\.m3u8?(\?|$)/i.test(path);
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error, status }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function rewritePlaylist(text: string, baseUrl: string, ua?: string | null): string {
  const base = new URL(baseUrl);
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      const withUri = line.replace(/URI="([^"]+)"/g, (_, uri) => {
        try {
          return `URI="${proxyUrl(new URL(uri, base).toString(), ua)}"`;
        } catch {
          return `URI="${uri}"`;
        }
      });
      if (withUri.startsWith("#")) return withUri;
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
  if (!target) return jsonError("missing ?u", 400);

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(target);
  } catch {
    return jsonError("invalid url", 400);
  }
  if (!/^https?:$/.test(upstreamUrl.protocol)) {
    return jsonError("bad protocol", 400);
  }

  const isLive = url.searchParams.get("kind") === "live";
  const playlistPath = isPlaylistPath(upstreamUrl.pathname);
  // LIVE strips Range completely; VOD/segment passes the client's Range through.
  const clientRange = isLive ? null : request.headers.get("range");

  const forcedUA = url.searchParams.get("ua");
  const uaCandidates = forcedUA ? Array.from(new Set([forcedUA, ...UA_LIST])) : UA_LIST;

  const upstreamOrigin = `${upstreamUrl.protocol}//${upstreamUrl.host}`;
  const buildHeaders = (ua: string) => {
    const h = new Headers();
    h.set("User-Agent", ua);
    h.set("Accept", "*/*");
    h.set("Accept-Encoding", "identity");
    h.set("Icy-MetaData", "0");
    // Alguns painéis verificam Referer/Origin para liberar o stream.
    h.set("Referer", `${upstreamOrigin}/`);
    h.set("Origin", upstreamOrigin);
    if (clientRange) h.set("Range", clientRange);
    return h;
  };

  let upstream: Response | null = null;
  let lastError: unknown = null;
  let lastStatus = 0;
  for (const ua of uaCandidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(upstreamUrl.toString(), {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        headers: buildHeaders(ua),
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      lastStatus = res.status;
      if (res.status === 401 || res.status === 403) {
        try { await res.body?.cancel(); } catch { /* noop */ }
        continue;
      }
      upstream = res;
      break;
    } catch (e) {
      lastError = e;
    }
  }

  if (!upstream) {
    const rawMsg = lastError instanceof Error ? lastError.message : "upstream fetch failed";
    const msg = maskUrlForLog(rawMsg);
    // 401/403 explícito do upstream: propaga com mensagem clara.
    if (lastStatus === 401 || lastStatus === 403) {
      return jsonError("Servidor recusou: usuário sem autorização, conta expirada ou limite de conexões.", lastStatus);
    }
    // Use 4xx (not 5xx) so the runtime-error boundary doesn't flag the
    // recoverable fallback as a blank-screen crash. The player already
    // walks to the next candidate on any non-OK response.
    return jsonError(msg, 424);
  }

  const ct = upstream.headers.get("content-type") || "";
  const isPlaylist =
    /mpegurl/i.test(ct) ||
    /\.m3u8(\?|$)/i.test(upstreamUrl.pathname) ||
    /\.m3u(\?|$)/i.test(upstreamUrl.pathname) ||
    playlistPath;

  // Sniff: alguns provedores devolvem 200 + corpo de texto com mensagem de
  // recusa ("UnauthorizedUser") em vez de 401. Sem isso, esse texto é
  // entregue como se fosse vídeo e o mpegts.js quebra de forma opaca.
  // Só sniffamos quando o Content-Type sugere texto/HTML/JSON (não vídeo).
  const looksTextual = /^(text\/|application\/(json|xml|xhtml))/i.test(ct);
  if (
    upstream.ok &&
    !isPlaylist &&
    looksTextual &&
    request.method !== "HEAD"
  ) {
    try {
      const bodyText = await upstream.clone().text();
      if (AUTH_FAIL_RE.test(bodyText)) {
        try { await upstream.body?.cancel(); } catch { /* noop */ }
        return jsonError(
          "Servidor recusou: usuário sem autorização, conta expirada ou limite de conexões.",
          401,
        );
      }
    } catch { /* noop */ }
  }

  const respHeaders = new Headers(CORS);

  // Pass through useful upstream headers.
  for (const h of ["content-length", "content-range", "accept-ranges", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }

  if (isLive) {
    // LIVE TS é stream contínuo — nunca anunciar tamanho/range fixo.
    respHeaders.delete("content-length");
    respHeaders.delete("content-range");
    respHeaders.delete("accept-ranges");
  }

  if (isPlaylist && upstream.ok) {
    const text = await upstream.text();
    const rewritten = rewritePlaylist(text, upstream.url || upstreamUrl.toString(), forcedUA);
    respHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
    respHeaders.delete("content-length");
    return new Response(rewritten, { status: upstream.status, headers: respHeaders });
  }

  // Content-Type: prefere upstream; se vier vazio/octet-stream, deduz pelo path.
  const badCt = !ct || /octet-stream|binary|text\/plain/i.test(ct);
  respHeaders.set("Content-Type", badCt ? contentTypeForPath(upstreamUrl.pathname) : ct);
  if (!isLive && !respHeaders.has("accept-ranges")) respHeaders.set("Accept-Ranges", "bytes");

  // Downgrade upstream 5xx → 424 so the runtime-error boundary doesn't flag
  // a recoverable proxy failure as a blank-screen crash. Player walks to the
  // next candidate on any non-OK status either way.
  const outStatus = upstream.status >= 500 ? 424 : upstream.status;
  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: outStatus,
    headers: respHeaders,
  });
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
