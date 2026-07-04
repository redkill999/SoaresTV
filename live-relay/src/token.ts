// -----------------------------------------------------------------------------
// AES-256-GCM opaque token verification (Node side).
// Format: b64url( VERSION(1=0x02) || IV(12) || CIPHERTEXT || TAG(16) )
// Key: SHA-256(LIVE_RELAY_ENCRYPTION_KEY) — matches the Lovable backend impl.
// -----------------------------------------------------------------------------
import { createDecipheriv, createHash } from "node:crypto";

export interface RelayTokenPayload {
  version: 1;
  host: string;
  port: number | null;
  protocol: "http" | "https";
  username: string;
  password: string;
  streamId: string;
  extension: "ts";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

const VERSION_AES_GCM_V1 = 0x02;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function b64urlDecode(s: string): Buffer {
  const pad = 4 - (s.length % 4 || 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + (pad === 4 ? "" : "=".repeat(pad));
  return Buffer.from(b64, "base64");
}

export function verifyRelayToken(
  token: string,
  encryptionKey: string,
): { ok: true; payload: RelayTokenPayload } | { ok: false; reason: string } {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    return { ok: false, reason: "token-shape" };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return { ok: false, reason: "token-chars" };

  let bytes: Buffer;
  try { bytes = b64urlDecode(token); } catch { return { ok: false, reason: "b64" }; }
  if (bytes.length < 1 + IV_BYTES + TAG_BYTES + 1) return { ok: false, reason: "length" };
  if (bytes[0] !== VERSION_AES_GCM_V1) return { ok: false, reason: "version" };

  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const rest = bytes.subarray(1 + IV_BYTES);
  const tag = rest.subarray(rest.length - TAG_BYTES);
  const ciphertext = rest.subarray(0, rest.length - TAG_BYTES);

  const key = createHash("sha256").update(encryptionKey, "utf8").digest();

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch { return { ok: false, reason: "decrypt" }; }

  let payload: RelayTokenPayload;
  try { payload = JSON.parse(plaintext.toString("utf8")) as RelayTokenPayload; }
  catch { return { ok: false, reason: "json" }; }

  if (!payload || typeof payload !== "object") return { ok: false, reason: "shape" };
  if (payload.version !== 1) return { ok: false, reason: "payload-version" };
  if (typeof payload.host !== "string" || !payload.host) return { ok: false, reason: "host" };
  if (payload.protocol !== "http" && payload.protocol !== "https") return { ok: false, reason: "protocol" };
  if (typeof payload.username !== "string" || !payload.username) return { ok: false, reason: "username" };
  if (typeof payload.password !== "string" || !payload.password) return { ok: false, reason: "password" };
  if (typeof payload.streamId !== "string" || !/^\d{1,12}$/.test(payload.streamId)) {
    return { ok: false, reason: "streamId" };
  }
  if (typeof payload.expiresAt !== "number" || Math.floor(Date.now() / 1000) > payload.expiresAt) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nonce !== "string" || payload.nonce.length < 8) {
    return { ok: false, reason: "nonce" };
  }
  return { ok: true, payload };
}
