// =============================================================================
// /api/live-diagnose — diagnóstico MANUAL do upstream Live (spec V5 §2/§3/§4).
//
// Acionado somente pelo botão "Testar upstream" no Modo Diagnóstico do player.
// NUNCA é executado automaticamente antes da reprodução (abriria uma segunda
// conexão com o provedor).
//
// Contrato:
//   1. recebe a mesma URL original usada pelo canal (?u=...);
//   2. valida protocolo e host (anti-SSRF via assertSafeUpstreamUrl);
//   3. abre UMA única conexão upstream;
//   4. aguarda o primeiro chunk por no máximo 8 s (Promise.race real);
//   5. lê no máximo 64 KB;
//   6. cancela imediatamente a conexão;
//   7. retorna JSON sanitizado (whitelist) — NUNCA URL, usuário, senha, token,
//      query string, corpo binário ou amostra textual.
//
// O endpoint sempre termina em no máximo ~10 s (8 s primeiro byte + ~1,2 s de
// leitura extra limitada).
// =============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { assertSafeUpstreamUrl, safeFetch } from "@/lib/server-guard";
import {
  LIVE_DIAGNOSE_EXTRA_READ_MS,
  LIVE_DIAGNOSE_MAX_BYTES,
  LIVE_DIAGNOSE_MIN_SAMPLE_BYTES,
  LIVE_FIRST_BYTE_TIMEOUT_MS,
  buildLiveDiagnoseBody,
  buildUpstreamRequestHeaders,
  classify403Body,
  classifyBodyKind,
  collectUpToLimit,
  findMpegTsSync,
  pickSafeResponseHeaders,
  readFirstChunkWithTimeout,
  readUpstreamErrorSample,
  sanitizeContentType,
} from "@/lib/live-stream-helpers";

const UA_DEFAULT = "XCIPTV/7.0 (Linux; Android 13)";


function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function handle(request: Request): Promise<Response> {
  const started = Date.now();
  const url = new URL(request.url);
  const target = url.searchParams.get("u");
  if (!target) {
    return json(400, buildLiveDiagnoseBody({ ok: false, errorCode: "MISSING_TARGET", firstByteReceived: false }));
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = assertSafeUpstreamUrl(target);
  } catch {
    return json(400, buildLiveDiagnoseBody({ ok: false, errorCode: "INVALID_TARGET", firstByteReceived: false }));
  }

  const ua = url.searchParams.get("ua") || UA_DEFAULT;

  // Timeout real (spec V5 §3): AbortController + timer cobre fetch + 1º byte.
  const firstByteController = new AbortController();
  const hardTimer = setTimeout(() => firstByteController.abort(), LIVE_FIRST_BYTE_TIMEOUT_MS);

  try {
    let upstream: Response;
    try {
      upstream = await safeFetch(upstreamUrl, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: firstByteController.signal,
        // V8 §4 — mesmo construtor usado no relay: sem Origin/Referer.
        headers: buildUpstreamRequestHeaders(ua),
      });
    } catch {
      // eslint-disable-next-line no-console
      console.log("[LIVE-DIAGNOSE] FETCH_ERROR", { host: upstreamUrl.host, elapsedMs: Date.now() - started });
      return json(502, buildLiveDiagnoseBody({
        ok: false,
        errorCode: "LIVE_UPSTREAM_FETCH_ERROR",
        firstByteReceived: false,
        elapsedMs: Date.now() - started,
      }));
    }

    const upstreamStatus = upstream.status;
    const upstreamContentType = sanitizeContentType(upstream.headers.get("content-type"));
    const safeHeaders = pickSafeResponseHeaders(upstream.headers);

    if (!upstream.ok) {
      // V8 §1 — classifica 403 (nunca loga/retorna o corpo original).
      let upstreamErrorClass: "NONE" | ReturnType<typeof classify403Body> = "NONE";
      let upstreamBodyLength = 0;
      const isTextual = /^(text|application\/(json|xml|xhtml))/.test(upstreamContentType);
      if (upstreamStatus === 403 && isTextual && upstream.body) {
        try {
          const s = await readUpstreamErrorSample(upstream.body.getReader());
          upstreamBodyLength = s.byteLength;
          upstreamErrorClass = classify403Body(s.text);
        } catch { /* noop */ }
      } else {
        try { await upstream.body?.cancel(); } catch { /* noop */ }
      }
      // eslint-disable-next-line no-console
      console.log("[LIVE-DIAGNOSE] HTTP_ERROR", {
        host: upstreamUrl.host,
        upstreamStatus,
        upstreamContentType,
        upstreamErrorClass,
        upstreamBodyLength,
        responseServer: safeHeaders.server,
        responseCfRay: safeHeaders.cfRay,
        responseVia: safeHeaders.via,
        responseRetryAfter: safeHeaders.retryAfter,
        responseLocationHost: safeHeaders.locationHost,
      });
      return json(502, buildLiveDiagnoseBody({
        ok: false,
        errorCode: "LIVE_UPSTREAM_HTTP_ERROR",
        upstreamStatus,
        upstreamContentType,
        firstByteReceived: false,
        elapsedMs: Date.now() - started,
        upstreamErrorClass,
        upstreamBodyLength,
        responseServer: safeHeaders.server,
        responseCfRay: safeHeaders.cfRay,
        responseVia: safeHeaders.via,
        responseRetryAfter: safeHeaders.retryAfter,
        responseLocationHost: safeHeaders.locationHost,
      }));
    }


    const reader = upstream.body?.getReader();
    if (!reader) {
      return json(502, buildLiveDiagnoseBody({
        ok: false,
        errorCode: "LIVE_UPSTREAM_NO_BODY",
        upstreamStatus,
        upstreamContentType,
        firstByteReceived: false,
        elapsedMs: Date.now() - started,
      }));
    }

    const firstByteStarted = Date.now();
    const remaining = Math.max(250, LIVE_FIRST_BYTE_TIMEOUT_MS - (Date.now() - started));
    const first = await readFirstChunkWithTimeout(reader, remaining);
    if (first.timedOut || !first.chunk || first.chunk.byteLength === 0) {
      try { await reader.cancel(); } catch { /* noop */ }
      firstByteController.abort();
      // eslint-disable-next-line no-console
      console.log("[LIVE-DIAGNOSE] NO_FIRST_BYTE", { host: upstreamUrl.host, upstreamStatus, elapsedMs: Date.now() - started });
      return json(504, buildLiveDiagnoseBody({
        ok: false,
        errorCode: "LIVE_UPSTREAM_NO_FIRST_BYTE",
        upstreamStatus,
        upstreamContentType,
        firstByteReceived: false,
        elapsedMs: Date.now() - started,
      }));
    }

    const firstByteMs = Date.now() - firstByteStarted;
    // Lê no máximo 64 KB (cap estrito) e cancela imediatamente.
    const sample = await collectUpToLimit(reader, first.chunk, {
      maxBytes: LIVE_DIAGNOSE_MAX_BYTES,
      minBytes: LIVE_DIAGNOSE_MIN_SAMPLE_BYTES,
      extraTimeMs: LIVE_DIAGNOSE_EXTRA_READ_MS,
    });
    try { await reader.cancel(); } catch { /* noop */ }
    firstByteController.abort();

    const syncOffset = findMpegTsSync(sample);
    const bodyKind = classifyBodyKind(sample);

    // eslint-disable-next-line no-console
    console.log("[LIVE-DIAGNOSE] OK", {
      host: upstreamUrl.host,
      upstreamStatus,
      upstreamContentType,
      firstByteMs,
      firstChunkBytes: sample.byteLength,
      mpegTsSyncFound: syncOffset >= 0,
      bodyKind,
    });

    return json(200, buildLiveDiagnoseBody({
      ok: true,
      upstreamStatus,
      upstreamContentType,
      firstByteReceived: true,
      firstByteMs,
      firstChunkBytes: sample.byteLength,
      mpegTsSyncFound: syncOffset >= 0,
      mpegTsSyncOffset: syncOffset,
      bodyKind,
      elapsedMs: Date.now() - started,
    }));
  } finally {
    clearTimeout(hardTimer);
    firstByteController.abort();
  }
}

export const Route = createFileRoute("/api/live-diagnose")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
    },
  },
});
