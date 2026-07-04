import { describe, it, expect } from "vitest";
import { parseM3UDetailed, parseM3U } from "@/lib/xtream";

describe("parseM3UDetailed", () => {
  it("captura tvg-id, tvg-name, tvg-chno, logo, group-title", () => {
    const txt = [
      "#EXTM3U",
      '#EXTINF:-1 tvg-id="globo.br" tvg-name="Globo HD" tvg-chno="4" tvg-logo="http://x/g.png" group-title="Abertos",Globo HD',
      "http://server/live/user/pass/1.ts",
    ].join("\n");
    const { entries } = parseM3UDetailed(txt);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "Globo HD",
      tvgId: "globo.br",
      tvgName: "Globo HD",
      tvgChno: "4",
      logo: "http://x/g.png",
      group: "Abertos",
      url: "http://server/live/user/pass/1.ts",
    });
  });

  it("extrai url-tvg do header #EXTM3U", () => {
    const txt = '#EXTM3U url-tvg="http://a/epg.xml,http://b/epg.xml.gz"\n#EXTINF:-1,A\nhttp://x/a.ts\n';
    const { epgUrls } = parseM3UDetailed(txt);
    expect(epgUrls).toEqual(["http://a/epg.xml", "http://b/epg.xml.gz"]);
  });

  it("captura #EXTVLCOPT (user-agent, referer) e #KODIPROP", () => {
    const txt = [
      "#EXTM3U",
      "#EXTINF:-1,Canal X",
      "#EXTVLCOPT:http-user-agent=MyUA/1.0",
      "#EXTVLCOPT:http-referrer=http://ref",
      "#KODIPROP:inputstream.adaptive.license_key=abc",
      "http://x/x.ts",
    ].join("\n");
    const { entries } = parseM3UDetailed(txt);
    expect(entries[0].userAgent).toBe("MyUA/1.0");
    expect(entries[0].referer).toBe("http://ref");
    expect(entries[0].kodiProps).toEqual({ "inputstream.adaptive.license_key": "abc" });
  });

  it("resolve URLs relativas via baseUrl", () => {
    const txt = "#EXTM3U\n#EXTINF:-1,A\nlive/1.ts\n";
    const { entries } = parseM3UDetailed(txt, { baseUrl: "http://srv/base/" });
    expect(entries[0].url).toBe("http://srv/base/live/1.ts");
  });

  it("suporta BOM e CRLF", () => {
    const txt = "\uFEFF#EXTM3U\r\n#EXTINF:-1,A\r\nhttp://x/a.ts\r\n";
    const { entries } = parseM3UDetailed(txt);
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe("http://x/a.ts");
  });

  it("#EXTGRP serve como fallback quando não há group-title", () => {
    const txt = "#EXTM3U\n#EXTINF:-1,A\n#EXTGRP:Esportes\nhttp://x/a.ts\n";
    const { entries } = parseM3UDetailed(txt);
    expect(entries[0].group).toBe("Esportes");
    expect(entries[0].extGroup).toBe("Esportes");
  });

  it("parseM3U (wrapper legado) mantém shape antigo", () => {
    const txt = "#EXTM3U\n#EXTINF:-1 tvg-logo=\"L\" group-title=\"G\",N\nhttp://u\n";
    const arr = parseM3U(txt);
    expect(arr[0]).toMatchObject({ name: "N", logo: "L", group: "G", url: "http://u" });
  });
});
