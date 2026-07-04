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
// V5 (fail-fast, spec §7/§8): a rota NUNCA fica silenciosa — se o upstream
// não entrega o primeiro chunk em 8 s, responde HTTP 504 com header
// `X-Live-Relay-Error: NO_FIRST_BYTE` e corpo JSON sanitizado. Todos os erros
// carregam `X-Live-Relay-Error` para o cliente exibir imediatamente, sem
// esperar o watchdog de 20 s. Em sucesso, expõe headers de diagnóstico
// sanitizados (status/tempo/bytes/sync) — nunca URL ou credenciais.
//
// SEGURANÇA: valida a URL via `assertSafeUpstreamUrl` (mesma proteção
// anti-SSRF do /api/stream). Não expõe URL/credenciais nos logs.
// =============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { assertSafeUpstreamUrl, safeFetch } from "@/lib/server-guard";
import {
  LIVE_FIRST_BYTE_TIMEOUT_MS,
  findMpegTsSync,
  looksLikeTextualErrorBody,
  readFirstChunkWithTimeout,
  sanitizeContentType,
} from "@/lib/live-stream-helpers";

const UA_LIST = [
  "XCIPTV/7.0 (Linux; Android 13)",
  "IPTV Smarters Pro/4.0",
  "TiviMate/5.1.0",
  "VLC/3.0.20 LibVLC/3.0.20",
  "okhttp/4.12.0",
];

// Headers de diagnóstico legíveis pelo cliente (fetch manual "Testar bytes
// do relay" e tratamento imediato de erro no player).
const EXPOSED_HEADERS = [
  "X-Live-Relay-Error",
  "X-Live-Upstream-Status",
  "X-Live-First-Byte-Ms",
  "X-Live-First-Chunk-Bytes",
  "X-Live-Ts-Sync-Found",
].join(", ");

function corsHeaders(request: Request): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Accept, Origin, Referer, User-Agent",
    "Access-Control-Expose-Headers": EXPOSED_HEADERS,
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

/** Resposta de erro do relay: SEMPRE com X-Live-Relay-Error + JSON sanitizado
 *  (apenas códigos e números — nunca URL, credenciais ou corpo do upstream). */
function relayError(
  status: number,
  code: string,
  cors: Record<string, string>,
  extra?: Record<string, number | boolean>,
): Response {
  const h = new Headers(cors);
  h.set("Content-Type", "application/json");
  h.set("Cache-Control", "no-store");
  h.set("X-Live-Relay-Error", code);
  return new Response(
    JSON.stringify({ ok: false, errorCode: code, ...(extra ?? {}) }),
    { status, headers: h },
  );
}

function sanitizedLog(event: string, fields: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console.log(`[LIVE-RELAY] ${event}`, fields);
}

async function handle(request: Request): Promise<Response> {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get("u");
  if (!target) {
    return relayError(400, "MISSING_TARGET", cors);
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = assertSafeUpstreamUrl(target);
  } catch {
    return relayError(400, "INVALID_TARGET", cors);
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
    return relayError(502, "FETCH_ERROR", cors);
  }

  if (!upstream.ok) {
    try { await upstream.body?.cancel(); } catch { /* noop */ }
    try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
    sanitizedLog("LIVE_UPSTREAM_HTTP_ERROR", {
      host: upstreamUrl.host,
      upstreamStatus: upstream.status,
    });
    return relayError(upstream.status, "HTTP_ERROR", cors, { upstreamStatus: upstream.status });
  }

  const reader = upstream.body?.getReader();
  if (!reader) {
    try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
    sanitizedLog("LIVE_UPSTREAM_NO_BODY", { host: upstreamUrl.host });
    return relayError(502, "NO_BODY", cors, { upstreamStatus: upstream.status });
  }

  const first = await readFirstChunkWithTimeout(reader, LIVE_FIRST_BYTE_TIMEOUT_MS);
  if (first.timedOut || !first.chunk || first.chunk.byteLength === 0) {
    try { await reader.cancel(); } catch { /* noop */ }
    upstreamController.abort();
    try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
    sanitizedLog("LIVE_UPSTREAM_NO_FIRST_BYTE", {
      host: upstreamUrl.host,
      upstreamStatus: upstream.status,
      upstreamContentType: sanitizeContentType(upstream.headers.get("content-type")),
      firstByteMs: Date.now() - started,
    });
    // Fail-fast (spec V5 §7): 504 + X-Live-Relay-Error: NO_FIRST_BYTE.
    return relayError(504, "NO_FIRST_BYTE", cors, {
      upstreamStatus: upstream.status,
      firstByteMs: Date.now() - started,
    });
  }

  const firstChunk = first.chunk;
  const firstByteMs = Date.now() - started;
  const syncOffset = findMpegTsSync(firstChunk);
  const isTextualError = syncOffset < 0 && looksLikeTextualErrorBody(firstChunk);
  if (isTextualError) {
    try { await reader.cancel(); } catch { /* noop */ }
    upstreamController.abort();
    try { request.signal.removeEventListener("abort", onClientAbort); } catch { /* noop */ }
    sanitizedLog("LIVE_UPSTREAM_TEXTUAL_BODY", {
      host: upstreamUrl.host,
      upstreamStatus: upstream.status,
      upstreamContentType: sanitizeContentType(upstream.headers.get("content-type")),
      firstChunkBytes: firstChunk.byteLength,
    });
    return relayError(502, "TEXTUAL_BODY", cors, {
      upstreamStatus: upstream.status,
      firstChunkBytes: firstChunk.byteLength,
    });
  }

  sanitizedLog("LIVE_UPSTREAM_FIRST_BYTE", {
    host: upstreamUrl.host,
    upstreamFinalHost: (() => { try { return new URL(upstream.url).host; } catch { return upstreamUrl.host; } })(),
    upstreamStatus: upstream.status,
    upstreamContentType: sanitizeContentType(upstream.headers.get("content-type")),
    firstByteReceived: true,
    firstByteMs,
    firstChunkBytes: firstChunk.byteLength,
    mpegTsSyncFound: syncOffset >= 0,
    mpegTsSyncOffset: syncOffset,
  });

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // O primeiro chunk usado na validação NÃO é perdido: é reenfileirado
      // antes de continuar bombeando os chunks seguintes (spec V5 §7).
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

  const headers = relayHeaders(cors);
  // Diagnóstico sanitizado no sucesso (apenas números/booleans).
  headers.set("X-Live-Upstream-Status", String(upstream.status));
  headers.set("X-Live-First-Byte-Ms", String(firstByteMs));
  headers.set("X-Live-First-Chunk-Bytes", String(firstChunk.byteLength));
  headers.set("X-Live-Ts-Sync-Found", String(syncOffset >= 0));
  return new Response(body, { status: 200, headers });
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
