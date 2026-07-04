import { describe, it, expect } from "vitest";
import {
  encryptRelayToken,
  decryptRelayToken,
  type LiveRelayTokenPayload,
} from "@/lib/live-relay-crypto";
import { parseXtreamLiveUrl } from "@/lib/external-live-relay";

const SECRET = "test-secret-for-aes-gcm-32-plus-characters-long";

function samplePayload(overrides: Partial<LiveRelayTokenPayload> = {}): LiveRelayTokenPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    version: 1,
    host: "suportejetflix.site",
    port: null,
    protocol: "https",
    username: "user123",
    password: "pass!@#456",
    streamId: "98765",
    extension: "ts",
    issuedAt: now,
    expiresAt: now + 60,
    nonce: "nonce-abcdefgh",
    ...overrides,
  };
}

describe("live-relay-crypto (AES-256-GCM)", () => {
  it("roundtrip: valid token decrypts to original payload", async () => {
    const p = samplePayload();
    const token = await encryptRelayToken(p, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // Ciphertext must NOT contain plaintext substrings.
    expect(token).not.toContain(p.username);
    expect(token).not.toContain(p.password);
    expect(token).not.toContain(p.host);
    const r = await decryptRelayToken(token, SECRET);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toEqual(p);
  });

  it("rejects tampered ciphertext", async () => {
    const token = await encryptRelayToken(samplePayload(), SECRET);
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A") + "C";
    const r = await decryptRelayToken(tampered, SECRET);
    expect(r.ok).toBe(false);
  });

  it("rejects wrong key", async () => {
    const token = await encryptRelayToken(samplePayload(), SECRET);
    const r = await decryptRelayToken(token, "other-secret-key-xxxxxxxxxxxxxxxx");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("decrypt");
  });

  it("rejects expired token", async () => {
    const p = samplePayload({ expiresAt: Math.floor(Date.now() / 1000) - 5 });
    const token = await encryptRelayToken(p, SECRET);
    const r = await decryptRelayToken(token, SECRET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects malformed tokens", async () => {
    for (const bad of ["", "not-a-token!", "AAAA"]) {
      const r = await decryptRelayToken(bad, SECRET);
      expect(r.ok).toBe(false);
    }
  });
});

describe("parseXtreamLiveUrl", () => {
  it("extracts host/port/protocol/user/pass/streamId from Xtream Live URL", () => {
    const p = parseXtreamLiveUrl("http://suportejetflix.site:8080/live/joao/senha123/98765.ts");
    expect(p).toEqual({
      host: "suportejetflix.site",
      port: 8080,
      protocol: "http",
      username: "joao",
      password: "senha123",
      streamId: "98765",
    });
  });

  it("handles URL-encoded credentials", () => {
    const p = parseXtreamLiveUrl("https://provider.example/live/u%40x/p%3F1/12345.ts");
    expect(p?.username).toBe("u@x");
    expect(p?.password).toBe("p?1");
  });

  it("rejects non-live paths and non-http protocols", () => {
    expect(parseXtreamLiveUrl("https://x/movie/u/p/1.mp4")).toBeNull();
    expect(parseXtreamLiveUrl("ftp://x/live/u/p/1.ts")).toBeNull();
    expect(parseXtreamLiveUrl("not a url")).toBeNull();
  });
});
