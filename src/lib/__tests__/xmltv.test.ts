import { describe, it, expect } from "vitest";
import { parseXmltv, parseXmltvDate, lookupNowProgramme } from "@/lib/xmltv";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="globo.br">
    <display-name>Globo HD</display-name>
    <display-name>Globo</display-name>
  </channel>
  <channel id="sbt.br">
    <display-name>SBT</display-name>
  </channel>
  <programme start="20260704120000 +0000" stop="20260704130000 +0000" channel="globo.br">
    <title>Jornal Hoje</title>
    <desc>Notícias &amp; análise</desc>
  </programme>
  <programme start="20260704130000 +0000" stop="20260704140000 +0000" channel="globo.br">
    <title>Novela</title>
  </programme>
</tv>`;

describe("parseXmltv", () => {
  it("indexa canais e programas por tvg-id", () => {
    const idx = parseXmltv(XML);
    expect(idx.totalProgrammes).toBe(2);
    expect(idx.byChannel.get("globo.br")).toHaveLength(2);
    expect(idx.byChannel.get("globo.br")![0].title).toBe("Jornal Hoje");
    expect(idx.byChannel.get("globo.br")![0].description).toBe("Notícias & análise");
  });

  it("mapeia display-name (lowercased) → channelId", () => {
    const idx = parseXmltv(XML);
    expect(idx.channelByDisplay.get("globo hd")).toBe("globo.br");
    expect(idx.channelByDisplay.get("sbt")).toBe("sbt.br");
  });

  it("parseXmltvDate lida com timezone e sem timezone", () => {
    expect(parseXmltvDate("20260704120000 +0000")).toBe(Date.UTC(2026, 6, 4, 12, 0, 0));
    expect(parseXmltvDate("20260704120000")).toBe(Date.UTC(2026, 6, 4, 12, 0, 0));
    expect(parseXmltvDate("20260704120000 -0300")).toBe(Date.UTC(2026, 6, 4, 15, 0, 0));
  });

  it("lookupNowProgramme casa por tvg-id", () => {
    const idx = parseXmltv(XML);
    const now = Date.UTC(2026, 6, 4, 12, 30, 0);
    const p = lookupNowProgramme(idx, { tvgId: "globo.br", nowMs: now });
    expect(p?.title).toBe("Jornal Hoje");
  });

  it("lookupNowProgramme faz fallback por display-name", () => {
    const idx = parseXmltv(XML);
    const now = Date.UTC(2026, 6, 4, 13, 30, 0);
    const p = lookupNowProgramme(idx, { tvgName: "Globo HD", nowMs: now });
    expect(p?.title).toBe("Novela");
  });

  it("retorna null quando nada casa", () => {
    const idx = parseXmltv(XML);
    expect(lookupNowProgramme(idx, { tvgId: "nao.existe", nowMs: Date.now() })).toBeNull();
  });
});
