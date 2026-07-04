// =============================================================================
// live-relay — standalone Node.js MPEG-TS relay for suportejetflix.site Live.
// Spec V-final: opaque AES-256-GCM token, static public IPv4, HTTP 403 handled
// as UPSTREAM_FORBIDDEN, progressive streaming, cancel on client disconnect.
//
// The relay never sees any provider credentials in an env var — they arrive
// encrypted inside the short-lived token. The Lovable backend and the relay
// share ONLY the symmetric key LIVE_RELAY_ENCRYPTION_KEY.
// =============================================================================

import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { Readable } from "node:stream";
import { verifyRelayToken } from "./token.js";
import { assertPublicHost } from "./ssrf-guard.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const ENCRYPTION_KEY = process.env.LIVE_RELAY_ENCRYPTION_KEY ?? "";
const ALLOWED_HOSTS = (process.env.ALLOWED_UPSTREAM_HOSTS ?? "suportejetflix.site")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*")
  .split(",").map((s) => s.trim()).filter(Boolean);
const FIRST_BYTE_TIMEOUT_MS = Number.parseInt(process.env.FIRST_BYTE_TIMEOUT_MS ?? "8000", 10);
const MAX_CONCURRENT = Number.parseInt(process.env.MAX_CONCURRENT ?? "50", 10);
const RATE_LIMIT_MAX = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "60", 10);
const RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW ?? "1 minute";
const UA = process.env.UPSTREAM_UA ?? "XCIPTV/7.0 (Linux; Android 13)";
const MAX_REDIRECTS = Number.parseInt(process.env.MAX_REDIRECTS ?? "3", 10);
const NONCE_TTL_MS = 5 * 60_000;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  // eslint-disable-next-line no-console
  console.error("[live-relay] Missing/short LIVE_RELAY_ENCRYPTION_KEY (need >= 32 chars). Refusing to start.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fastify
// ---------------------------------------------------------------------------
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "req.headers.authorization", "req.headers.cookie",
        "req.query.token", "req.params.token",
        "*.token", "*.password", "*.pass", "*.user", "*.username",
        "*.upstreamUrl", "*.url",
      ],
      remove: true,
    },
  },
  disableRequestLogging: true,
  trustProxy: true,
});

await app.register(rateLimit, {
  max: RATE_LIMIT_MAX,
  timeWindow: RATE_LIMIT_WINDOW,
  keyGenerator: (req) => req.ip,
});

// ---------------------------------------------------------------------------
// State: nonce replay-protection window + active connection counter
// ---------------------------------------------------------------------------
let activeConnections = 0;
const seenNonces = new Map<string, number>(); // nonce → expiry epoch ms
function checkAndRecordNonce(nonce: string, expiresAtSec: number): boolean {
  const now = Date.now();
  for (const [k, exp] of seenNonces) if (exp < now) seenNonces.delete(k);
  if (seenNonces.has(nonce)) return false;
  seenNonces.set(nonce, Math.min(now + NONCE_TTL_MS, expiresAtSec * 1000 + 5_000));
  return true;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/health", async () => ({
  ok: true,
  version: "v2-aes-gcm",
  allowedUpstreamHosts: ALLOWED_HOSTS,
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
    .header("Access-Control-Expose-Headers",
      "X-Live-Relay-Version, X-Live-Relay-Upstream-Status, X-Live-Relay-Error")
    .header("Vary", "Origin");
  if (origin) reply.header("Access-Control-Allow-Origin", origin);
  return reply.send();
});

// ---------------------------------------------------------------------------
// Main streaming endpoint
// ---------------------------------------------------------------------------
app.get<{ Params: { token: string } }>("/live/:token", async (req, reply) => {
  const origin = pickAllowedOrigin(req);
  if (!ALLOWED_ORIGINS.includes("*") && !origin) {
    reply.code(403);
    return { code: "ORIGIN_NOT_ALLOWED", message: "Origem não autorizada." };
  }
  if (activeConnections >= MAX_CONCURRENT) {
    reply.code(503);
    return { code: "TOO_MANY_CONNECTIONS", message: "Relay temporariamente saturado." };
  }

  // 1) decrypt + validate token
  const parsed = verifyRelayToken(req.params.token, ENCRYPTION_KEY);
  if (!parsed.ok) {
    app.log.info({ event: "TOKEN_REJECTED", reason: parsed.reason }, "token rejected");
    reply.code(401);
    return { code: "TOKEN_INVALID", message: "Token expirado ou inválido." };
  }
  const { host, port, protocol, username, password, streamId, nonce, expiresAt } = parsed.payload;

  // 2) anti-replay
  if (!checkAndRecordNonce(nonce, expiresAt)) {
    app.log.info({ event: "NONCE_REPLAY" }, "nonce replay");
    reply.code(401);
    return { code: "NONCE_REPLAY", message: "Token já utilizado." };
  }

  // 3) host allowlist
  const allowed = ALLOWED_HOSTS.includes(host)
    || ALLOWED_HOSTS.some((h) => host.endsWith(`.${h}`));
  if (!allowed) {
    app.log.info({ event: "HOST_NOT_ALLOWED", host }, "host not allowed");
    reply.code(403);
    return { code: "HOST_NOT_ALLOWED", message: "Host não autorizado." };
  }

  // 4) SSRF guard
  try { await assertPublicHost(host); } catch {
    app.log.info({ event: "SSRF_BLOCKED", host }, "ssrf blocked");
    reply.code(400);
    return { code: "SSRF_BLOCKED", message: "Destino privado bloqueado." };
  }

  // 5) reconstruct upstream URL — NEVER logged, NEVER placed in a response
  const portPart = port ? `:${port}` : "";
  const streamUrl =
    `${protocol}://${host}${portPart}/live/` +
    `${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.ts`;

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
    app.log.info({ event: "RELAY_CLOSED", reason, host, streamId, activeConnections },
      "relay closed");
  };
  req.raw.on("close", () => cleanup("client-close"));

  // 6) first-byte timeout
  const firstByteTimer = setTimeout(() => {
    if (!upstreamController.signal.aborted) upstreamController.abort("first-byte-timeout");
  }, FIRST_BYTE_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(streamUrl, {
      method: "GET",
      redirect: "follow", // Node's fetch honors a low default; MAX_REDIRECTS documented.
      cache: "no-store",
      signal: upstreamController.signal,
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
  } catch (err) {
    clearTimeout(firstByteTimer);
    cleanup("fetch-error");
    const aborted = (err as { name?: string })?.name === "AbortError";
    app.log.info({ event: "UPSTREAM_FETCH_ERROR", host, streamId, aborted },
      "upstream fetch error");
    reply.code(502);
    return {
      code: aborted ? "FIRST_BYTE_TIMEOUT" : "FETCH_ERROR",
      message: aborted
        ? "O servidor do canal não respondeu no prazo."
        : "Falha ao conectar ao servidor do canal.",
    };
  }
  void MAX_REDIRECTS; // documented; Node's fetch caps at 20 by default

  // 7) Spec §8 — HTTP 403: sanitized UPSTREAM_FORBIDDEN, no retry, no player.
  if (upstream.status === 403) {
    clearTimeout(firstByteTimer);
    const responseServer = upstream.headers.get("server") ?? "-";
    const cfRay = upstream.headers.get("cf-ray") ?? "-";
    try { await upstream.body?.cancel(); } catch { /* noop */ }
    cleanup("upstream-403");
    app.log.warn({
      event: "UPSTREAM_FORBIDDEN",
      host, streamId,
      upstreamStatus: 403,
      responseServer,
      cfRay,
      classification: cfRay !== "-" ? "cloudflare-block" : "provider-block",
      adminHint: "O IP público do relay precisa ser liberado pelo provedor.",
    }, "upstream 403 — relay IP not authorized");
    reply.code(403);
    reply.header("X-Live-Relay-Error", "UPSTREAM_FORBIDDEN");
    return {
      code: "UPSTREAM_FORBIDDEN",
      message: "O provedor recusou o IP do relay. Solicite a liberação do IP ao administrador do serviço.",
      upstreamStatus: 403,
      responseServer,
    };
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(firstByteTimer);
    try { await upstream.body?.cancel(); } catch { /* noop */ }
    cleanup("upstream-not-ok");
    app.log.info({
      event: "UPSTREAM_HTTP_ERROR",
      host, streamId, upstreamStatus: upstream.status,
    }, "upstream not ok");
    reply.code(upstream.status);
    return { code: "UPSTREAM_ERROR", upstreamStatus: upstream.status,
      message: `Servidor do canal respondeu ${upstream.status}.` };
  }

  const firstByteMs = Date.now() - startedAt;
  clearTimeout(firstByteTimer);

  app.log.info({
    event: "UPSTREAM_OPEN", host, streamId,
    upstreamStatus: upstream.status, firstByteMs,
  }, "upstream open");

  // 8) progressive pipe — no buffering, no text()/arrayBuffer()/blob()
  reply.raw.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Cache-Control": "no-store, no-cache, must-revalidate, no-transform",
    Pragma: "no-cache",
    Expires: "0",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
    "X-Live-Relay-Version": "v2-aes-gcm",
    "X-Live-Relay-Upstream-Status": String(upstream.status),
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });

  const nodeStream = Readable.fromWeb(
    upstream.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
  );
  nodeStream.on("error", () => cleanup("upstream-error"));
  reply.raw.on("close", () => cleanup("response-close"));
  nodeStream.pipe(reply.raw);

  return reply;
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    app.log.info({ event: "SHUTDOWN", signal: sig }, "shutting down");
    try { await app.close(); } catch { /* noop */ }
    process.exit(0);
  });
}

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info({ event: "READY", port: PORT, allowedUpstreamHosts: ALLOWED_HOSTS },
    "live-relay ready");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
