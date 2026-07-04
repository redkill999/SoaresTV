import { describe, it, expect } from "vitest";
import {
  findMpegTsSync,
  looksLikeTextualErrorBody,
  FORBIDDEN_RESPONSE_HEADERS,
  classifyBodyKind,
  readFirstChunkWithTimeout,
  collectUpToLimit,
  buildLiveDiagnoseBody,
  sanitizeContentType,
  LIVE_DIAGNOSE_MAX_BYTES,
  classify403Body,
  pickSafeResponseHeaders,
  buildUpstreamRequestHeaders,
  UPSTREAM_ERROR_BODY_MAX_BYTES,
} from "@/lib/live-stream-helpers";


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

type MockReader = ReadableStreamDefaultReader<Uint8Array> & {
  reads: number;
  wasCancelled: boolean;
};

function mockReader(chunks: Uint8Array[], opts?: { hangAfter?: boolean }): MockReader {
  let i = 0;
  const state = { reads: 0, wasCancelled: false };
  const reader = {
    get reads() { return state.reads; },
    get wasCancelled() { return state.wasCancelled; },
    read: async () => {
      state.reads += 1;
      if (i < chunks.length) return { done: false as const, value: chunks[i++] };
      if (opts?.hangAfter) return new Promise<never>(() => { /* nunca resolve */ });
      return { done: true as const, value: undefined };
    },
    cancel: async () => { state.wasCancelled = true; },
    releaseLock: () => undefined,
    closed: Promise.resolve(undefined),
  };
  return reader as unknown as MockReader;
}

describe("findMpegTsSync", () => {
  it("reconhece sync no offset 0", () => {
    expect(findMpegTsSync(tsPacket(0))).toBe(0);
  });
  it("reconhece sync em offset intermediário (chunk que começa no meio de um pacote)", () => {
    expect(findMpegTsSync(tsPacket(37))).toBe(37);
  });
  it("identifica MPEG-TS por pacotes de 188 bytes (3 pacotes consecutivos)", () => {
    const buf = tsPacket(0, 3);
    expect(findMpegTsSync(buf)).toBe(0);
    // Quebra o terceiro pacote: sync deve ser rejeitado.
    buf[376] = 0x00;
    expect(findMpegTsSync(buf)).toBe(-1);
  });
  it("retorna -1 para chunk claramente não TS (HTML)", () => {
    const html = new TextEncoder().encode("<html><body>error</body></html>");
    expect(findMpegTsSync(html)).toBe(-1);
  });
  it("retorna -1 quando não há bytes suficientes para verificar 2 pacotes", () => {
    expect(findMpegTsSync(new Uint8Array([0x47]))).toBe(-1);
  });
});

describe("classifyBodyKind", () => {
  it("MPEG-TS é identificado como mpegts", () => {
    expect(classifyBodyKind(tsPacket(0, 4))).toBe("mpegts");
  });
  it("HTML é identificado como html", () => {
    expect(classifyBodyKind(new TextEncoder().encode("<html><body>login invalido</body></html>"))).toBe("html");
  });
  it("JSON é identificado como json", () => {
    expect(classifyBodyKind(new TextEncoder().encode('{"error":"max connections"}'))).toBe("json");
  });
  it("texto plano de erro é identificado como text", () => {
    expect(classifyBodyKind(new TextEncoder().encode("Unauthorized user"))).toBe("text");
  });
  it("binário sem sync TS é identificado como unknown", () => {
    const bin = new Uint8Array(300);
    for (let i = 0; i < bin.length; i++) bin[i] = i % 2 === 0 ? 0x00 : 0x80;
    expect(classifyBodyKind(bin)).toBe("unknown");
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

describe("readFirstChunkWithTimeout (spec V5 §3)", () => {
  it("sem primeiro byte: expira dentro do timeout (bem antes de 10s)", async () => {
    const reader = mockReader([], { hangAfter: true });
    const started = Date.now();
    const r = await readFirstChunkWithTimeout(reader, 150);
    const elapsed = Date.now() - started;
    expect(r.timedOut).toBe(true);
    expect(r.chunk).toBeNull();
    expect(elapsed).toBeLessThan(10_000);
  });
  it("entrega o primeiro chunk quando disponível", async () => {
    const chunk = tsPacket(0, 2);
    const reader = mockReader([chunk]);
    const r = await readFirstChunkWithTimeout(reader, 1_000);
    expect(r.timedOut).toBe(false);
    expect(r.chunk?.byteLength).toBe(chunk.byteLength);
  });
});

describe("collectUpToLimit (spec V5 §2)", () => {
  it("limita o resultado a 64 KB mesmo com primeiro chunk maior", async () => {
    const big = new Uint8Array(100 * 1024).fill(0x47);
    const reader = mockReader([]);
    const out = await collectUpToLimit(reader, big, {
      maxBytes: LIVE_DIAGNOSE_MAX_BYTES,
      minBytes: 4096,
      extraTimeMs: 200,
    });
    expect(out.byteLength).toBe(LIVE_DIAGNOSE_MAX_BYTES);
  });
  it("acumula chunks pequenos até o mínimo para classificação", async () => {
    const small = () => new Uint8Array(1024).fill(0x01);
    const reader = mockReader([small(), small(), small(), small(), small()]);
    const out = await collectUpToLimit(reader, small(), {
      maxBytes: LIVE_DIAGNOSE_MAX_BYTES,
      minBytes: 4096,
      extraTimeMs: 500,
    });
    expect(out.byteLength).toBeGreaterThanOrEqual(4096);
    expect(out.byteLength).toBeLessThanOrEqual(LIVE_DIAGNOSE_MAX_BYTES);
  });
  it("não continua lendo quando o primeiro chunk já satisfaz o mínimo (reader pode ser cancelado)", async () => {
    const reader = mockReader([new Uint8Array(8192)]);
    await collectUpToLimit(reader, new Uint8Array(8192), {
      maxBytes: LIVE_DIAGNOSE_MAX_BYTES,
      minBytes: 4096,
      extraTimeMs: 500,
    });
    expect(reader.reads).toBe(0);
    await reader.cancel();
    expect(reader.wasCancelled).toBe(true);
  });
});

describe("buildLiveDiagnoseBody (sanitização, spec V5 §2/§12)", () => {
  it("nunca inclui URL, credenciais ou query no JSON", () => {
    const body = buildLiveDiagnoseBody({
      ok: true,
      upstreamStatus: 200,
      upstreamContentType: 'video/mp2t; boundary="http://user:pass@evil.example/?u=x"',
      firstByteReceived: true,
      firstByteMs: 1234,
      firstChunkBytes: 16384,
      mpegTsSyncFound: true,
      mpegTsSyncOffset: 0,
      bodyKind: "mpegts",
    });
    const s = JSON.stringify(body);
    expect(s).not.toContain("://");
    expect(s).not.toContain("@");
    expect(s).not.toContain("u=");
    expect(s).not.toContain("user");
    expect(s).not.toContain("pass");
    expect(body.upstreamContentType).toBe("video/mp2t");
    expect(body.firstChunkBytes).toBe(16384);
  });
  it("sanitiza errorCode para conter apenas [A-Z0-9_]", () => {
    const body = buildLiveDiagnoseBody({
      ok: false,
      errorCode: "NO_FIRST_BYTE?u=http://x@y",
      firstByteReceived: false,
    });
    expect(body.errorCode).toBe("NO_FIRST_BYTEuhttpxy");
    expect(JSON.stringify(body)).not.toContain("://");
  });
});

describe("sanitizeContentType", () => {
  it("remove parâmetros e caracteres inválidos", () => {
    expect(sanitizeContentType('Video/MP2T; charset="x"')).toBe("video/mp2t");
    expect(sanitizeContentType(null)).toBe("");
    expect(sanitizeContentType("text/html<script>")).toBe("text/htmlscript");
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
