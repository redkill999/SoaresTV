import { createFileRoute } from "@tanstack/react-router";
import { maskIptvUrl } from "@/lib/iptv-url";

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
  "XCIPTV/7.0 (Linux; Android 13)",
  "IPTV Smarters Pro/4.0",
  "TiviMate/5.1.0",
  "VLC/3.0.20 LibVLC/3.0.20",
  "okhttp/4.12.0",
  "Mozilla/5.0",
];

// Padrões que indicam recusa de autenticação devolvida como corpo (em vez de
// 401/403 HTTP). Painéis Xtream tipicamente devolvem 200 + texto.
const AUTH_FAIL_RE = /UnauthorizedUser|Invalid\s+username|Invalid\s+password|User\s+expired|Account\s+expired|Not\s+allowed|Max\s+connections|Blocked|Banned|forbidden/i;
const AUTH_REASON = "Servidor recusou autenticação ou autorização.";

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

function jsonError(error: string, status: number, responseStatus = status): Response {
  return new Response(JSON.stringify({ error, status }), {
    status: responseStatus >= 500 ? 424 : responseStatus,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function jsonData(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function isProbablyText(contentType: string): boolean {
  return /^(text\/|application\/(json|xml|xhtml))/i.test(contentType);
}

function isProbablyPlayable(contentType: string, path: string): boolean {
  return /video\/|mpegurl|mp2t|octet-stream|binary/i.test(contentType) || /\.(ts|m3u8?|mp4|m4v|mov|mkv|webm)(\?|$)/i.test(path);
}

async function bodyPreview(res: Response, maxBytes = 512, timeoutMs = 1_500): Promise<string> {
  const clone = res.clone();
  const timeout = new Promise<Uint8Array[]>((resolve) => setTimeout(() => resolve([]), timeoutMs));
  const read = (async () => {
    const chunks: Uint8Array[] = [];
    const reader = clone.body?.getReader();
    if (!reader) return chunks;
    let total = 0;
    try {
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.byteLength;
        if (value.byteLength === 0) break;
      }
    } finally {
      try { await reader.cancel(); } catch { /* noop */ }
    }
    return chunks;
  })();
  const chunks = await Promise.race([read, timeout]);
  const bytes = new Uint8Array(Math.min(maxBytes, chunks.reduce((sum, c) => sum + c.byteLength, 0)));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.slice(0, Math.max(0, bytes.length - offset));
    bytes.set(slice, offset);
    offset += slice.byteLength;
    if (offset >= bytes.length) break;
  }
  try {
    return new TextDecoder().decode(bytes).replace(/\s+/g, " ").trim().slice(0, 240);
  } catch {
    return "";
  }
}

function reasonForStatus(status: number): string | undefined {
  if (status === 401 || status === 403) return AUTH_REASON;
  if (status === 404) return "Stream não encontrado no servidor.";
  if (status === 424 || status === 502 || status === 503 || status === 504 || status >= 500) {
    return "Proxy não conseguiu abrir o stream. O servidor pode estar bloqueando o IP do Web Desktop.";
  }
  return undefined;
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
  const isProbe = url.searchParams.get("probe") === "1";

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
    try { h.set("Connection", "keep-alive"); } catch { /* forbidden in some fetch runtimes */ }
    // Alguns painéis verificam Referer/Origin para liberar o stream.
    h.set("Referer", `${upstreamOrigin}/`);
    h.set("Origin", upstreamOrigin);
    if (clientRange) h.set("Range", clientRange);
    return h;
  };

  let upstream: Response | null = null;
  let lastError: unknown = null;
  let lastStatus = 0;
  let lastPreview = "";
  let lastContentType = "";
  let lastNonPlayableReason = "";
  let authRejected = false;
  for (const ua of uaCandidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(upstreamUrl.toString(), {
        method: isProbe ? "GET" : request.method === "HEAD" ? "HEAD" : "GET",
        headers: buildHeaders(ua),
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      lastStatus = res.status;
      lastContentType = res.headers.get("content-type") || "";
      if (res.status === 401 || res.status === 403) {
        authRejected = true;
        try { await res.body?.cancel(); } catch { /* noop */ }
        continue;
      }
      const loopCt = lastContentType;
      const loopIsPlaylist = /mpegurl/i.test(loopCt) || isPlaylistPath(upstreamUrl.pathname);
      if (!loopIsPlaylist && (isProbe || isLive || isProbablyText(loopCt) || !res.ok)) {
        const preview = await bodyPreview(res);
        if (preview) lastPreview = preview;
        if (AUTH_FAIL_RE.test(preview)) {
          authRejected = true;
          lastStatus = 401;
          try { await res.body?.cancel(); } catch { /* noop */ }
          continue;
        }
      }
      if ((isProbe || isLive) && !res.ok) {
        lastNonPlayableReason = reasonForStatus(res.status) || `Stream upstream HTTP ${res.status}`;
        try { await res.body?.cancel(); } catch { /* noop */ }
        continue;
      }
      if ((isProbe || isLive) && res.ok) {
        const loopPlayable = (loopIsPlaylist || isProbablyPlayable(loopCt, upstreamUrl.pathname)) && !(isProbablyText(loopCt) && !loopIsPlaylist);
        if (!loopPlayable) {
          lastNonPlayableReason = "Resposta upstream não parece vídeo.";
          try { await res.body?.cancel(); } catch { /* noop */ }
          continue;
        }
      }
      upstream = res;
      break;
    } catch (e) {
      lastError = e;
    }
  }

  if (!upstream) {
    const rawMsg = lastError instanceof Error ? lastError.message : "upstream fetch failed";
    const msg = maskIptvUrl(rawMsg);
    // 401/403 explícito do upstream: propaga com mensagem clara.
    if (authRejected || lastStatus === 401 || lastStatus === 403) {
      const status = lastStatus === 403 ? 403 : 401;
      if (isProbe) {
        return jsonData({
          ok: false,
          status,
          contentType: "",
          finalUrlHost: upstreamUrl.host,
          reason: AUTH_REASON,
          bodyPreview: maskIptvUrl(lastPreview),
        });
      }
      return jsonError("Servidor recusou: usuário sem autorização, conta expirada ou limite de conexões.", status);
    }
    // Use 4xx (not 5xx) so the runtime-error boundary doesn't flag the
    // recoverable fallback as a blank-screen crash. The player already
    // walks to the next candidate on any non-OK response.
    if (isProbe) {
      return jsonData({
        ok: false,
        status: lastStatus || 424,
          contentType: lastContentType,
        finalUrlHost: upstreamUrl.host,
          reason: lastNonPlayableReason || reasonForStatus(lastStatus || 424) || msg,
          bodyPreview: lastPreview ? maskIptvUrl(lastPreview) : undefined,
      });
    }
    return jsonError(lastNonPlayableReason || msg, lastStatus >= 400 ? lastStatus : 424);
  }

  const ct = upstream.headers.get("content-type") || "";
  const finalUrlHost = (() => {
    try { return new URL(upstream?.url || upstreamUrl.toString()).host; } catch { return upstreamUrl.host; }
  })();
  const isPlaylist =
    /mpegurl/i.test(ct) ||
    /\.m3u8(\?|$)/i.test(upstreamUrl.pathname) ||
    /\.m3u(\?|$)/i.test(upstreamUrl.pathname) ||
    playlistPath;

  // Sniff: alguns provedores devolvem 200 + corpo de texto com mensagem de
  // recusa ("UnauthorizedUser") em vez de 401. Sem isso, esse texto é
  // entregue como se fosse vídeo e o mpegts.js quebra de forma opaca.
  // Só sniffamos quando o Content-Type sugere texto/HTML/JSON (não vídeo).
  const looksTextual = isProbablyText(ct);
  const needsPreview = request.method !== "HEAD" && !isPlaylist && (isProbe || isLive || looksTextual || !upstream.ok);
  let preview = lastPreview;
  if (needsPreview) {
    try {
      if (!preview) preview = await bodyPreview(upstream);
      if (AUTH_FAIL_RE.test(preview)) {
        try { await upstream.body?.cancel(); } catch { /* noop */ }
        if (isProbe) {
          return jsonData({
            ok: false,
            status: 401,
            contentType: ct,
            finalUrlHost,
            reason: AUTH_REASON,
            bodyPreview: maskIptvUrl(preview),
          });
        }
        return jsonError("Servidor recusou: usuário sem autorização, conta expirada ou limite de conexões.", 401);
      }
    } catch { /* noop */ }
  }

  const playable = upstream.ok && (isPlaylist || isProbablyPlayable(ct, upstreamUrl.pathname)) && !(looksTextual && !isPlaylist);
  if (isProbe) {
    return jsonData({
      ok: playable,
      status: upstream.status,
      contentType: ct,
      finalUrlHost,
      reason: playable ? undefined : reasonForStatus(upstream.status) || "Resposta upstream não parece vídeo.",
      bodyPreview: !playable && preview ? maskIptvUrl(preview) : undefined,
    });
  }

  if (isLive && !upstream.ok) {
    try { await upstream.body?.cancel(); } catch { /* noop */ }
    return jsonError(reasonForStatus(upstream.status) || `Stream upstream HTTP ${upstream.status}`, upstream.status);
  }

  if (isLive && upstream.ok && !isPlaylist && looksTextual) {
    try { await upstream.body?.cancel(); } catch { /* noop */ }
    return jsonError("Resposta upstream não parece vídeo.", 424);
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
