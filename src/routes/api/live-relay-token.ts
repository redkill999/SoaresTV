// =============================================================================
// /api/live-relay-token — spec V-final §4. Emits an AES-256-GCM opaque token
// that carries the upstream URL details (host/port/protocol/user/pass/streamId)
// encrypted with LIVE_RELAY_ENCRYPTION_KEY. The token is only decryptable by
// the external live-relay, which shares the same key.
//
// Frontend contract:
//   POST { host, port?, protocol, username, password, streamId, kind: "live" }
//   → { ok: true, token, expiresInSeconds }
//
// Allowlist: only hosts explicitly authorized for the Web-Desktop relay.
// Validity: 60 seconds (spec §4).
// Never logs credentials, URL or token.
// =============================================================================

import { createFileRoute } from "@tanstack/react-router";
import { encryptRelayToken, type LiveRelayTokenPayload } from "@/lib/live-relay-crypto";

const ALLOWED_HOSTS = new Set(["suportejetflix.site"]);
const TOKEN_TTL_SECONDS = 60;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function handle(request: Request): Promise<Response> {
  // Env is injected per-request on the Worker — read inside the handler.
  const secret = process.env.LIVE_RELAY_ENCRYPTION_KEY;
  if (!secret) {
    return json(503, { ok: false, errorCode: "RELAY_ENCRYPTION_KEY_NOT_CONFIGURED" });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false, errorCode: "INVALID_BODY" });
  }

  const host = typeof body.host === "string" ? body.host.trim().toLowerCase() : "";
  const streamId = typeof body.streamId === "string" ? body.streamId.trim() : "";
  const kind = body.kind === "live" ? "live" : "";
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  const protocol = body.protocol === "http" ? "http" : "https";
  const rawPort = body.port;
  const port =
    typeof rawPort === "number" && Number.isFinite(rawPort) && rawPort > 0 && rawPort < 65536
      ? Math.trunc(rawPort)
      : null;

  if (!host || host.length > 120 || !/^[a-z0-9.-]+$/.test(host)) {
    return json(400, { ok: false, errorCode: "INVALID_HOST" });
  }
  const allowed =
    ALLOWED_HOSTS.has(host) || [...ALLOWED_HOSTS].some((h) => host.endsWith(`.${h}`));
  if (!allowed) return json(403, { ok: false, errorCode: "HOST_NOT_ALLOWED" });

  if (!/^\d{1,12}$/.test(streamId)) return json(400, { ok: false, errorCode: "INVALID_STREAM_ID" });
  if (kind !== "live") return json(400, { ok: false, errorCode: "INVALID_KIND" });
  if (!username || username.length > 200) return json(400, { ok: false, errorCode: "INVALID_USERNAME" });
  if (!password || password.length > 200) return json(400, { ok: false, errorCode: "INVALID_PASSWORD" });

  const now = Math.floor(Date.now() / 1000);
  const payload: LiveRelayTokenPayload = {
    version: 1,
    host,
    port,
    protocol,
    username,
    password,
    streamId,
    extension: "ts",
    issuedAt: now,
    expiresAt: now + TOKEN_TTL_SECONDS,
    nonce: crypto.randomUUID(),
  };

  let token: string;
  try {
    token = await encryptRelayToken(payload, secret);
  } catch {
    return json(500, { ok: false, errorCode: "ENCRYPT_FAILED" });
  }

  // Sanitized log — host only, never URL/user/pass/token.
  // eslint-disable-next-line no-console
  console.log("[LIVE-RELAY-TOKEN] issued", { host, streamId, ttl: TOKEN_TTL_SECONDS });

  return json(200, { ok: true, token, expiresInSeconds: TOKEN_TTL_SECONDS });
}

export const Route = createFileRoute("/api/live-relay-token")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
