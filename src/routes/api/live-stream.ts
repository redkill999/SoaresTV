// =============================================================================
// /api/live-stream — relay binário contínuo dedicado a MPEG-TS Live.
//
// Motivação (spec V4): o proxy /api/stream compartilha caminho com HLS/VOD/
// probe e passa pelo mesmo pipeline "sniff → validar → repassar", que em
// alguns runtimes bufferiza a resposta inteira e nunca entrega bytes ao
// navegador. Este endpoint serve APENAS o caso Live MPEG-TS:
//   - abre o upstream com fetch (redirect: follow) e AbortController;
//   - aguarda somente o PRIMEIRO chunk com timeout de 8 s;
//   - repassa o primeiro chunk + os seguintes progressivamente via
//     ReadableStream — sem text()/arrayBuffer()/buffer completo;
//   - conecta o cancelamento do cliente ao upstream (uma única conexão);
//   - responde com headers do relay Live (video/mp2t, no-store, no-buffering)
//     e SEM Content-Length/Content-Encoding/etc.
//
// SEGURANÇA: valida a URL via `assertSafeUpstreamUrl` (mesma proteção
// anti-SSRF do /api/stream). Não expõe URL/credenciais nos logs.
// =============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { assertSafeUpstreamUrl, safeFetch } from "@/lib/server-guard";
import { findMpegTsSync, looksLikeTextualErrorBody } from "@/lib/live-stream-helpers";

const FIRST_BYTE_TIMEOUT_MS = 8_000;

const UA_LIST = [
  "XCIPTV/7.0 (Linux; Android 13)",
  "IPTV Smarters Pro/4.0",
  "TiviMate/5.1.0",
  "VLC/3.0.20 LibVLC/3.0.20",
  "okhttp/4.12.0",
];

function corsHeaders(request: Request): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Accept, Origin, Referer, User-Agent",
    Vary: "Origin",
  };
  const reqOrigin = request.headers.get("origin");
  if (!reqOrigin) return base;
  let selfOrigin = "";
  try { selfOrigin = new URL(request.url).origin; } catch { /* noop */ }
  if (reqOrigin === selfOrigin) base["Access-Control-Allow-Origin"] = reqOrigin;
  return base;
}

function relayHeaders(cors: Record<string, string>): Headers {
  const h = new Headers(cors);
  h.set("Content-Type", "video/mp2t");
  h.set("Cache-Control", "no-store, no-cache, must-revalidate, no-transform");
  h.set("Pragma", "no-cache");
  h.set("Expires", "0");
  h.set("X-Accel-Buffering", "no");
  // Não encaminhamos: Content-Length, Content-Range, Accept-Ranges,
  // Content-Encoding, Transfer-Encoding, Connection, Keep-Alive.
  return h;
}

function sanitizedLog(event: string, fields: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-RELAY] ${event}`, fields);
}

async function readFirstChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<{ chunk: Uint8Array | null; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<{ chunk: null; timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ chunk: null, timedOut: true }), timeoutMs);
  });
  try {
    const readPromise = reader.read().then((r) => ({
      chunk: (r.done ? null : (r.value ?? null)) as Uint8Array | null,
      timedOut: false as const,
    }));
    const winner = await Promise.race([readPromise, timeoutPromise]);
    return winner;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function handle(request: Request): Promise<Response> {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("u");
  if (!target) {
    return new Response("missing ?u", { status: 400, headers: cors });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = assertSafeUpstreamUrl(target);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "invalid url";
    return new Response(msg, { status: 400, headers: cors });
  }

  const forcedUA = url.searchParams.get("ua");
  const ua = forcedUA || UA_LIST[0];

  // Um único AbortController por request: cancela upstream quando o cliente
  // desconecta OU quando decidimos abortar por timeout do primeiro byte.
  const upstreamController = new AbortController();
  const onClientAbort = () => upstreamController.abort();
  try { request.signal.addEventListener("abort", onClientAbort, { once: true }); } catch { /* noop */ }

  const started = Date.now();
  const originHeader = `${upstreamUrl.protocol}//${upstreamUrl.host}`;
  let upstream: Response;
  try {
    upstream = await safeFetch(upstreamUrl, {
      method: "GET",
      cache: "no-store",
      signal: upstreamController.signal,
      headers: {
        "User-Agent": ua,
        Accept: "*/*",
        "Cache-Control": "no-cache",
        "Accept-Encoding": "identity",
        Referer: `${originHeader}/`,
        Origin: originHeader,
      },
    });
  } catch (e) {
    try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
    const aborted = (e as { name?: string })?.name === "AbortError";
    sanitizedLog("LIVE_UPSTREAM_FETCH_ERROR", {
      host: upstreamUrl.host,
      aborted,
    });
    return new Response("LIVE_UPSTREAM_FETCH_ERROR", { status: 502, headers: cors });
  }

  if (!upstream.ok) {
    try { await upstream.body?.cancel(); } catch { /* noop */ }
    try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
    sanitizedLog("LIVE_UPSTREAM_HTTP_ERROR", {
      host: upstreamUrl.host,
      upstreamStatus: upstream.status,
    });
    return new Response("LIVE_UPSTREAM_HTTP_ERROR", { status: upstream.status, headers: cors });
  }

  const reader = upstream.body?.getReader();
  if (!reader) {
    try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
    sanitizedLog("LIVE_UPSTREAM_NO_BODY", { host: upstreamUrl.host });
    return new Response("LIVE_UPSTREAM_NO_BODY", { status: 502, headers: cors });
  }

  const first = await readFirstChunkWithTimeout(reader, FIRST_BYTE_TIMEOUT_MS);
  if (first.timedOut || !first.chunk || first.chunk.byteLength === 0) {
    try { await reader.cancel(); } catch { /* noop */ }
    upstreamController.abort();
    try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
    sanitizedLog("LIVE_UPSTREAM_NO_FIRST_BYTE", {
      host: upstreamUrl.host,
      upstreamStatus: upstream.status,
      upstreamContentType: upstream.headers.get("content-type") || "",
      firstByteMs: Date.now() - started,
    });
    return new Response("LIVE_UPSTREAM_NO_FIRST_BYTE", { status: 504, headers: cors });
  }

  const firstChunk = first.chunk;
  const syncOffset = findMpegTsSync(firstChunk);
  const isTextualError = syncOffset < 0 && looksLikeTextualErrorBody(firstChunk);
  if (isTextualError) {
    try { await reader.cancel(); } catch { /* noop */ }
    upstreamController.abort();
    try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
    sanitizedLog("LIVE_UPSTREAM_TEXTUAL_BODY", {
      host: upstreamUrl.host,
      upstreamStatus: upstream.status,
      upstreamContentType: upstream.headers.get("content-type") || "",
      firstChunkBytes: firstChunk.byteLength,
    });
    return new Response("LIVE_UPSTREAM_TEXTUAL_BODY", { status: 502, headers: cors });
  }

  sanitizedLog("LIVE_UPSTREAM_FIRST_BYTE", {
    host: upstreamUrl.host,
    upstreamFinalHost: (() => { try { return new URL(upstream.url).host; } catch { return upstreamUrl.host; } })(),
    upstreamStatus: upstream.status,
    upstreamContentType: upstream.headers.get("content-type") || "",
    firstByteReceived: true,
    firstByteMs: Date.now() - started,
    firstChunkBytes: firstChunk.byteLength,
    mpegTsSyncFound: syncOffset >= 0,
    mpegTsSyncOffset: syncOffset,
  });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(firstChunk);
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { controller.close(); break; }
            if (value && value.byteLength > 0) controller.enqueue(value);
          }
        } catch (err) {
          try { controller.error(err); } catch { /* noop */ }
        } finally {
          try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
        }
      };
      void pump();
    },
    cancel() {
      try { void reader.cancel(); } catch { /* noop */ }
      upstreamController.abort();
      try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
    },
  });

  return new Response(body, { status: 200, headers: relayHeaders(cors) });
}

export const Route = createFileRoute("/api/live-stream")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),
      GET: async ({ request }) => handle(request),
      HEAD: async ({ request }) => {
        // HEAD: mesmo contrato de headers, sem body. Nunca abre upstream real.
        const cors = corsHeaders(request);
        return new Response(null, { status: 200, headers: relayHeaders(cors) });
      },
    },
  },
});
