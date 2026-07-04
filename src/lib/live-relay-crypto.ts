// =============================================================================
// AES-256-GCM opaque token for the external live-relay.
//
// Spec V-final §4: the browser must never see the upstream URL, username,
// password or provider token. The Lovable backend receives an opaque request,
// encrypts a payload with `LIVE_RELAY_ENCRYPTION_KEY` and returns a token that
// only the relay can decrypt (with the same key).
//
// Wire format (base64url):
//   b64url( VERSION(1) || IV(12) || CIPHERTEXT || TAG(16) )
// VERSION byte identifies the encryption scheme (0x02 = AES-GCM v1).
// The key is derived by SHA-256 over the raw env-var value so any string
// length is accepted (32 raw bytes are produced deterministically).
// =============================================================================

const VERSION_AES_GCM_V1 = 0x02;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface LiveRelayTokenPayload {
  version: 1;
  host: string;      // upstream provider host (e.g. suportejetflix.site)
  port: number | null;
  protocol: "http" | "https";
  username: string;
  password: string;
  streamId: string;
  extension: "ts";
  issuedAt: number;  // epoch seconds
  expiresAt: number; // epoch seconds
  nonce: string;
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = 4 - (s.length % 4 || 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + (pad === 4 ? "" : "=".repeat(pad));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypt a payload into an opaque token. Never logs plaintext. */
export async function encryptRelayToken(
  payload: LiveRelayTokenPayload,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error("LIVE_RELAY_ENCRYPTION_KEY not configured");
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  const out = new Uint8Array(1 + IV_BYTES + encrypted.byteLength);
  out[0] = VERSION_AES_GCM_V1;
  out.set(iv, 1);
  out.set(encrypted, 1 + IV_BYTES);
  return b64urlEncode(out);
}

/** Decrypt an opaque token. Never returns partial payloads on failure. */
export async function decryptRelayToken(
  token: string,
  secret: string,
): Promise<
  | { ok: true; payload: LiveRelayTokenPayload }
  | { ok: false; reason: string }
> {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    return { ok: false, reason: "shape" };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return { ok: false, reason: "chars" };
  let bytes: Uint8Array;
  try { bytes = b64urlDecode(token); } catch { return { ok: false, reason: "decode" }; }
  if (bytes.length < 1 + IV_BYTES + TAG_BYTES + 1) return { ok: false, reason: "length" };
  if (bytes[0] !== VERSION_AES_GCM_V1) return { ok: false, reason: "version" };
  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const cipher = bytes.subarray(1 + IV_BYTES);
  let plaintext: ArrayBuffer;
  try {
    const key = await deriveKey(secret);
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  } catch { return { ok: false, reason: "decrypt" }; }
  let payload: LiveRelayTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext)) as LiveRelayTokenPayload;
  } catch { return { ok: false, reason: "json" }; }
  if (!payload || typeof payload !== "object") return { ok: false, reason: "shape" };
  if (payload.version !== 1) return { ok: false, reason: "payload-version" };
  if (typeof payload.host !== "string" || !payload.host) return { ok: false, reason: "host" };
  if (payload.protocol !== "http" && payload.protocol !== "https") return { ok: false, reason: "protocol" };
  if (typeof payload.streamId !== "string" || !/^\d{1,12}$/.test(payload.streamId)) {
    return { ok: false, reason: "streamId" };
  }
  if (typeof payload.expiresAt !== "number" || Math.floor(Date.now() / 1000) > payload.expiresAt) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nonce !== "string" || payload.nonce.length < 8) return { ok: false, reason: "nonce" };
  return { ok: true, payload };
}
