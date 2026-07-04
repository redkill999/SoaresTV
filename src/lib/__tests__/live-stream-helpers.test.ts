import { describe, it, expect } from "vitest";
import { findMpegTsSync, looksLikeTextualErrorBody, FORBIDDEN_RESPONSE_HEADERS } from "@/lib/live-stream-helpers";

function tsPacket(offset = 0, count = 3): Uint8Array {
  // Constrói um buffer com `offset` bytes de ruído + `count` pacotes MPEG-TS
  // válidos (188 bytes cada, iniciando com sync byte 0x47).
  const buf = new Uint8Array(offset + count * 188);
  for (let i = 0; i < offset; i++) buf[i] = 0xff;
  for (let p = 0; p < count; p++) {
    buf[offset + p * 188] = 0x47;
    // resto zero — suficiente para o teste de sync.
  }
  return buf;
}

describe("findMpegTsSync", () => {
  it("reconhece sync no offset 0", () => {
    expect(findMpegTsSync(tsPacket(0))).toBe(0);
  });
  it("reconhece sync em offset intermediário (chunk que começa no meio de um pacote)", () => {
    expect(findMpegTsSync(tsPacket(37))).toBe(37);
  });
  it("retorna -1 para chunk claramente não TS (HTML)", () => {
    const html = new TextEncoder().encode("<html><body>error</body></html>");
    expect(findMpegTsSync(html)).toBe(-1);
  });
  it("retorna -1 quando não há bytes suficientes para verificar 2 pacotes", () => {
    expect(findMpegTsSync(new Uint8Array([0x47]))).toBe(-1);
  });
});

describe("looksLikeTextualErrorBody", () => {
  it("aceita HTML", () => {
    expect(looksLikeTextualErrorBody(new TextEncoder().encode("<html>oops</html>"))).toBe(true);
  });
  it("aceita JSON", () => {
    expect(looksLikeTextualErrorBody(new TextEncoder().encode('{"error":"max connections"}'))).toBe(true);
  });
  it("aceita mensagem 'Unauthorized'", () => {
    expect(looksLikeTextualErrorBody(new TextEncoder().encode("Unauthorized user"))).toBe(true);
  });
  it("rejeita buffer binário (MPEG-TS)", () => {
    expect(looksLikeTextualErrorBody(tsPacket(0, 4))).toBe(false);
  });
});

describe("FORBIDDEN_RESPONSE_HEADERS", () => {
  it("inclui todos os headers proibidos no relay Live", () => {
    for (const name of [
      "content-length",
      "content-range",
      "accept-ranges",
      "content-encoding",
      "transfer-encoding",
      "connection",
      "keep-alive",
    ]) {
      expect(FORBIDDEN_RESPONSE_HEADERS).toContain(name);
    }
  });
});
