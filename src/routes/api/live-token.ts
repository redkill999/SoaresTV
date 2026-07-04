// =============================================================================
// /api/live-token — emissão de token curto assinado para o relay Live EXTERNO
// opcional (spec V5 §10/§11). Recurso INERTE por padrão: sem o secret
// LIVE_RELAY_TOKEN_SECRET configurado, responde 503 e nada muda no player.
//
// O token carrega APENAS identificadores (providerId/streamId/kind/exp/nonce),
// assinados com HMAC-SHA256 — NUNCA usuário, senha, token do provedor ou URL.
// O relay externo valida a assinatura e reconstrói a URL do provedor no
// servidor, com credenciais configuradas lá (nunca expostas na query pública).
//
// Allowlist: somente hosts com Web-Live override (suportejetflix.site).
// Validade: 60 s para iniciar a conexão.
// =============================================================================

import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_HOSTS = new Set(["suportejetflix.site"]);
const TOKEN_TTL_SECONDS = 60;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function b64url(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const Route = createFileRoute("/api/live-token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Secret lido DENTRO do handler (env é injetado por request no Worker).
        const secret = process.env.LIVE_RELAY_TOKEN_SECRET;
        if (!secret) {
          return json(503, { ok: false, errorCode: "RELAY_TOKEN_NOT_CONFIGURED" });
        }

        let body: { host?: unknown; streamId?: unknown; kind?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json(400, { ok: false, errorCode: "INVALID_BODY" });
        }

        const host = typeof body.host === "string" ? body.host.trim().toLowerCase() : "";
        const streamId = typeof body.streamId === "string" ? body.streamId.trim() : "";
        const kind = body.kind === "live" ? "live" : "";

        if (!host || host.length > 120 || !/^[a-z0-9.-]+$/.test(host)) {
          return json(400, { ok: false, errorCode: "INVALID_HOST" });
        }
        const allowed =
          ALLOWED_HOSTS.has(host) ||
          [...ALLOWED_HOSTS].some((h) => host.endsWith(`.${h}`));
        if (!allowed) {
          return json(403, { ok: false, errorCode: "HOST_NOT_ALLOWED" });
        }
        if (!/^\d{1,12}$/.test(streamId)) {
          return json(400, { ok: false, errorCode: "INVALID_STREAM_ID" });
        }
        if (kind !== "live") {
          return json(400, { ok: false, errorCode: "INVALID_KIND" });
        }

        const payload = {
          providerId: host,
          streamId,
          kind,
          exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
          nonce: crypto.randomUUID(),
        };
        const enc = new TextEncoder();
        const payloadB64 = b64url(enc.encode(JSON.stringify(payload)));
        const key = await crypto.subtle.importKey(
          "raw",
          enc.encode(secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64)));
        return json(200, {
          ok: true,
          token: `${payloadB64}.${b64url(sig)}`,
          expiresInSeconds: TOKEN_TTL_SECONDS,
        });
      },
    },
  },
});
