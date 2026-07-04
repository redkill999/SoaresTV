// =============================================================================
// live-relay — standalone Node.js MPEG-TS relay for suportejetflix.site Live.
//
// Why this exists (external to Lovable):
//   The published Lovable runtime does not deliver long-lived progressive
//   MPEG-TS bodies to the browser (headers arrive but the body never streams).
//   This tiny service runs on a normal Node.js host (Fly, Render, VPS, etc.)
//   and is used ONLY for:
//     - host suportejetflix.site
//     - Live streams
//     - Web Desktop browser
//   APK, Android TV, Movies, Series, other providers do NOT touch this service.
//
// Contract with the Lovable app:
//   1. Browser asks the app for a short-lived signed token (`/api/live-token`).
//   2. Browser calls `${VITE_LIVE_RELAY_BASE_URL}/live/:token`.
//   3. This service verifies HMAC, reconstructs the upstream URL from
//      env-configured credentials, opens ONE upstream, and pipes progressively.
//   4. Closing the browser aborts the upstream immediately.
//
// Security:
//   - Token is HMAC-SHA256 over `{providerId,streamId,kind:"live",exp,nonce}`.
//   - Credentials (`PROVIDER_USER`, `PROVIDER_PASS`) live only on the relay,
//     never in the token, query, or any log.
//   - Allowlist: PROVIDER_HOST env, defaults to `suportejetflix.site`.
//   - SSRF guard: refuses to hit private / loopback / link-local addresses.
//   - Origin validation via `ALLOWED_ORIGINS`.
//   - Rate limiting via @fastify/rate-limit.
//   - MAX_CONCURRENT limits simultaneous upstream connections.
// =============================================================================

import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { Readable } from "node:stream";
import { verifyRelayToken } from "./token.js";
import { assertPublicHost } from "./ssrf-guard.js";

// ---------------------------------------------------------------------------
// Env config
// ---------------------------------------------------------------------------
const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const TOKEN_SECRET = process.env.LIVE_RELAY_TOKEN_SECRET ?? "";
const PROVIDER_HOST = (process.env.PROVIDER_HOST ?? "suportejetflix.site").toLowerCase();
const PROVIDER_USER = process.env.PROVIDER_USER ?? "";
const PROVIDER_PASS = process.env.PROVIDER_PASS ?? "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const FIRST_BYTE_TIMEOUT_MS = Number.parseInt(process.env.FIRST_BYTE_TIMEOUT_MS ?? "8000", 10);
const MAX_CONCURRENT = Number.parseInt(process.env.MAX_CONCURRENT ?? "50", 10);
const RATE_LIMIT_MAX = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "60", 10);
const RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW ?? "1 minute";
const UA = process.env.UPSTREAM_UA ?? "XCIPTV/7.0 (Linux; Android 13)";

if (!TOKEN_SECRET) {
  // Fail loudly on boot — the relay is useless without the shared secret.
  // eslint-disable-next-line no-console
  console.error("[live-relay] Missing LIVE_RELAY_TOKEN_SECRET — refusing to start.");
  process.exit(1);
}
if (!PROVIDER_USER || !PROVIDER_PASS) {
  // eslint-disable-next-line no-console
  console.error("[live-relay] Missing PROVIDER_USER / PROVIDER_PASS — refusing to start.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fastify
// ---------------------------------------------------------------------------
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      // Hard redaction so accidental fields never leak.
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.query.token",
        "*.token",
        "*.password",
        "*.pass",
        "*.user",
        "*.upstreamUrl",
      ],
      remove: true,
    },
  },
  disableRequestLogging: true, // we log a sanitized line ourselves
  trustProxy: true,
});

await app.register(rateLimit, {
  max: RATE_LIMIT_MAX,
  timeWindow: RATE_LIMIT_WINDOW,
  keyGenerator: (req) => req.ip,
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/health", async () => ({
  ok: true,
  version: "v1",
  providerHost: PROVIDER_HOST,
  activeConnections,
  maxConcurrent: MAX_CONCURRENT,
}));

// ---------------------------------------------------------------------------
// CORS (single narrow endpoint)
// ---------------------------------------------------------------------------
function pickAllowedOrigin(req: { headers: { origin?: string } }): string | null {
  const o = req.headers.origin ?? "";
  if (!o) return null;
  if (ALLOWED_ORIGINS.includes("*")) return o;
  return ALLOWED_ORIGINS.includes(o) ? o : null;
}

app.options("/live/:token", async (req, reply) => {
  const origin = pickAllowedOrigin(req);
  reply
    .code(204)
    .header("Access-Control-Allow-Methods", "GET, OPTIONS")
    .header("Access-Control-Allow-Headers", "Content-Type, Range, Accept, Origin")
    .header("Access-Control-Expose-Headers", "X-Live-Relay-Version, X-Live-Relay-Upstream-Status, X-Live-Relay-First-Chunk-Bytes")
    .header("Vary", "Origin");
  if (origin) reply.header("Access-Control-Allow-Origin", origin);
  return reply.send();
});

// ---------------------------------------------------------------------------
// Main streaming endpoint
// ---------------------------------------------------------------------------
let activeConnections = 0;

app.get<{ Params: { token: string } }>("/live/:token", async (req, reply) => {
  const origin = pickAllowedOrigin(req);
  if (!ALLOWED_ORIGINS.includes("*") && !origin) {
    reply.code(403);
    return { ok: false, errorCode: "ORIGIN_NOT_ALLOWED" };
  }
  if (activeConnections >= MAX_CONCURRENT) {
    reply.code(503);
    return { ok: false, errorCode: "TOO_MANY_CONNECTIONS" };
  }

  // 1) verify token
  const parsed = verifyRelayToken(req.params.token, TOKEN_SECRET);
  if (!parsed.ok) {
    app.log.info({ event: "TOKEN_REJECTED", reason: parsed.reason }, "token rejected");
    reply.code(401);
    return { ok: false, errorCode: "TOKEN_INVALID" };
  }
  const { providerId, streamId } = parsed.payload;

  // 2) allowlist providerId
  if (providerId !== PROVIDER_HOST && !providerId.endsWith(`.${PROVIDER_HOST}`)) {
    app.log.info({ event: "HOST_NOT_ALLOWED", providerId }, "host not allowed");
    reply.code(403);
    return { ok: false, errorCode: "HOST_NOT_ALLOWED" };
  }

  // 3) SSRF guard: refuse to open upstream on private ranges
  try { await assertPublicHost(providerId); } catch {
    app.log.info({ event: "SSRF_BLOCKED", providerId }, "ssrf blocked");
    reply.code(400);
    return { ok: false, errorCode: "SSRF_BLOCKED" };
  }

  // 4) reconstruct upstream URL SERVER-SIDE from env credentials.
  //    The URL, user and pass NEVER leave this process (not in logs, not in
  //    headers, not in the response). URL is not built into any string that
  //    might land in an error message.
  const upstreamHost = providerId;
  const originHeader = `https://${upstreamHost}`;
  const streamUrl =
    `https://${upstreamHost}/live/${encodeURIComponent(PROVIDER_USER)}/` +
    `${encodeURIComponent(PROVIDER_PASS)}/${streamId}.ts`;

  const upstreamController = new AbortController();
  const startedAt = Date.now();
  activeConnections += 1;

  let cleanupCompleted = false;
  const cleanup = (reason: string) => {
    if (cleanupCompleted) return;
    cleanupCompleted = true;
    activeConnections = Math.max(0, activeConnections - 1);
    if (!upstreamController.signal.aborted) {
      try { upstreamController.abort(reason); } catch { /* noop */ }
    }
    app.log.info({
      event: "RELAY_CLOSED",
      reason,
      providerHost: upstreamHost,
      streamId,
      activeConnections,
    }, "relay closed");
  };

  // Abort upstream as soon as the browser disconnects.
  req.raw.on("close", () => cleanup("client-close"));

  // 5) open upstream + first-byte timeout
  const firstByteTimer = setTimeout(() => {
    if (!upstreamController.signal.aborted) upstreamController.abort("first-byte-timeout");
  }, FIRST_BYTE_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(streamUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: upstreamController.signal,
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        Referer: `${originHeader}/`,
        Origin: originHeader,
      },
    });
  } catch (err) {
    clearTimeout(firstByteTimer);
    cleanup("fetch-error");
    const aborted = (err as { name?: string })?.name === "AbortError";
    app.log.info({
      event: "UPSTREAM_FETCH_ERROR",
      providerHost: upstreamHost,
      streamId,
      aborted,
    }, "upstream fetch error");
    reply.code(502);
    return { ok: false, errorCode: aborted ? "FIRST_BYTE_TIMEOUT" : "FETCH_ERROR" };
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(firstByteTimer);
    try { await upstream.body?.cancel(); } catch { /* noop */ }
    cleanup("upstream-not-ok");
    app.log.info({
      event: "UPSTREAM_HTTP_ERROR",
      providerHost: upstreamHost,
      streamId,
      upstreamStatus: upstream.status,
    }, "upstream not ok");
    reply.code(upstream.status);
    return { ok: false, errorCode: "UPSTREAM_ERROR", upstreamStatus: upstream.status };
  }

  const firstByteMs = Date.now() - startedAt;
  clearTimeout(firstByteTimer);

  app.log.info({
    event: "UPSTREAM_OPEN",
    providerHost: upstreamHost,
    streamId,
    upstreamStatus: upstream.status,
    firstByteMs,
  }, "upstream open");

  // 6) write headers with NO Content-Length / Content-Encoding / Transfer-Encoding
  reply.raw.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Cache-Control": "no-store, no-cache, must-revalidate, no-transform",
    Pragma: "no-cache",
    Expires: "0",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
    "X-Live-Relay-Version": "v1",
    "X-Live-Relay-Upstream-Status": String(upstream.status),
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });

  // 7) progressive pipe (Web ReadableStream → Node Readable → raw response)
  const nodeStream = Readable.fromWeb(upstream.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>);
  nodeStream.on("error", () => cleanup("upstream-error"));
  reply.raw.on("close", () => cleanup("response-close"));
  nodeStream.pipe(reply.raw);

  // Signal to Fastify that we own the raw response.
  return reply;
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info({ event: "READY", port: PORT, providerHost: PROVIDER_HOST }, "live-relay ready");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
