import { describe, it, expect } from "vitest";
import { isValidLiveStream, normalizeLiveStreamsResponse } from "@/lib/xtream";

describe("isValidLiveStream", () => {
  it("aceita objeto Xtream sem `url`", () => {
    expect(isValidLiveStream({ stream_id: 42, name: "Globo HD", category_id: "1" })).toBe(true);
  });
  it("aceita stream_id como string numérica", () => {
    expect(isValidLiveStream({ stream_id: "42", name: "SBT" })).toBe(true);
  });
  it("rejeita sem name", () => {
    expect(isValidLiveStream({ stream_id: 1 })).toBe(false);
    expect(isValidLiveStream({ stream_id: 1, name: "   " })).toBe(false);
  });
  it("rejeita sem stream_id", () => {
    expect(isValidLiveStream({ name: "X" })).toBe(false);
    expect(isValidLiveStream({ stream_id: null, name: "X" })).toBe(false);
  });
  it("rejeita não-objetos", () => {
    expect(isValidLiveStream(null)).toBe(false);
    expect(isValidLiveStream("Globo")).toBe(false);
    expect(isValidLiveStream(42)).toBe(false);
  });
});

describe("normalizeLiveStreamsResponse", () => {
  it("array direto de canais Xtream", () => {
    const r = normalizeLiveStreamsResponse([
      { stream_id: 1, name: "Globo", category_id: 5 },
      { stream_id: 2, name: "SBT", category_id: "5" },
    ]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ stream_id: 1, name: "Globo", category_id: "5" });
  });

  it("string JSON válida", () => {
    const r = normalizeLiveStreamsResponse('[{"stream_id":1,"name":"A"}]');
    expect(r).toHaveLength(1);
    expect(r[0].stream_id).toBe(1);
  });

  it("resposta encapsulada em `data`", () => {
    const r = normalizeLiveStreamsResponse({ data: [{ stream_id: 3, name: "C" }] });
    expect(r).toHaveLength(1);
  });

  it("resposta encapsulada em `streams`/`live_streams`/`results`", () => {
    expect(normalizeLiveStreamsResponse({ streams: [{ stream_id: 1, name: "A" }] })).toHaveLength(1);
    expect(normalizeLiveStreamsResponse({ live_streams: [{ stream_id: 2, name: "B" }] })).toHaveLength(1);
    expect(normalizeLiveStreamsResponse({ results: [{ stream_id: 3, name: "C" }] })).toHaveLength(1);
  });

  it("descarta itens inválidos mas mantém canais sem stream_icon/url", () => {
    const r = normalizeLiveStreamsResponse([
      { stream_id: 1, name: "OK" },
      { stream_id: "abc", name: "bad-id" },
      { stream_id: 2, name: "" },
      null,
      "x",
      { stream_id: 3, name: "OK2" },
    ]);
    expect(r.map((s) => s.stream_id)).toEqual([1, 3]);
    expect(r[0].stream_icon).toBe("");
  });

  it("rejeita HTML como resposta", () => {
    expect(() => normalizeLiveStreamsResponse("<!doctype html>...")).toThrow();
  });

  it("rejeita JSON inválido", () => {
    expect(() => normalizeLiveStreamsResponse("not json")).toThrow();
  });

  it("rejeita objeto de erro Xtream", () => {
    expect(() => normalizeLiveStreamsResponse({ error: "bad creds" })).toThrow();
  });

  it("stream_id não-numérico é descartado", () => {
    const r = normalizeLiveStreamsResponse([{ stream_id: "abc", name: "X" }]);
    expect(r).toHaveLength(0);
  });
});
