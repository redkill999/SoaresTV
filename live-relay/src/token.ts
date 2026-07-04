// -----------------------------------------------------------------------------
// Token verification (HMAC-SHA256, base64url).
// Format emitted by /api/live-token in the Lovable app:
//   `${b64url(JSON.stringify(payload))}.${b64url(signature)}`
// Payload (produced by the app, verified here):
//   { providerId: string, streamId: string, kind: "live", exp: number, nonce: string }
// The relay NEVER accepts a URL/user/pass in the token — only identifiers.
// -----------------------------------------------------------------------------
import { createHmac, timingSafeEqual } from "node:crypto";

export interface RelayTokenPayload {
  providerId: string;
  streamId: string;
  kind: "live";
  exp: number;
  nonce: string;
}

function b64urlDecode(s: string): Buffer {
  const pad = 4 - (s.length % 4 || 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + (pad === 4 ? "" : "=".repeat(pad));
  return Buffer.from(b64, "base64");
}

export function verifyRelayToken(
  token: string,
  secret: string,
): { ok: true; payload: RelayTokenPayload } | { ok: false; reason: string } {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { ok: false, reason: "token-shape" };
  }
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "token-shape" };
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(payloadB64) || !/^[A-Za-z0-9_-]+$/.test(sigB64)) {
    return { ok: false, reason: "token-chars" };
  }

  const expected = createHmac("sha256", secret).update(payloadB64).digest();
  let received: Buffer;
  try { received = b64urlDecode(sigB64); } catch { return { ok: false, reason: "sig-decode" }; }
  if (expected.length !== received.length) return { ok: false, reason: "sig-length" };
  if (!timingSafeEqual(expected, received)) return { ok: false, reason: "sig-mismatch" };

  let payload: RelayTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as RelayTokenPayload;
  } catch { return { ok: false, reason: "payload-json" }; }

  if (typeof payload !== "object" || payload === null) return { ok: false, reason: "payload-shape" };
  if (typeof payload.providerId !== "string" || !payload.providerId) return { ok: false, reason: "payload-host" };
  if (typeof payload.streamId !== "string" || !/^\d{1,12}$/.test(payload.streamId)) return { ok: false, reason: "payload-stream" };
  if (payload.kind !== "live") return { ok: false, reason: "payload-kind" };
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return { ok: false, reason: "payload-exp" };
  if (Math.floor(Date.now() / 1000) > payload.exp) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}
