import { describe, it, expect, beforeEach, vi } from "vitest";

// Isolar módulo para exercitar migração e overrides sem estado global compartilhado.
async function loadModule() {
  vi.resetModules();
  return await import("@/lib/host-profile");
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom-only */ }
});

describe("getWebLiveProviderOverride — suportejetflix.site", () => {
  it("host exato encontra override", async () => {
    const { getWebLiveProviderOverride } = await loadModule();
    expect(getWebLiveProviderOverride("suportejetflix.site")?.strategy).toBe("hls-proxy-first");
  });
  it("www.suportejetflix.site encontra override", async () => {
    const { getWebLiveProviderOverride } = await loadModule();
    expect(getWebLiveProviderOverride("www.suportejetflix.site")).not.toBeNull();
  });
  it("suportejetflix.site:443 encontra override", async () => {
    const { getWebLiveProviderOverride } = await loadModule();
    expect(getWebLiveProviderOverride("suportejetflix.site:443")).not.toBeNull();
  });
  it("subdomínio encontra override", async () => {
    const { getWebLiveProviderOverride } = await loadModule();
    expect(getWebLiveProviderOverride("cdn.suportejetflix.site")).not.toBeNull();
  });
  it("outro domínio NÃO recebe override", async () => {
    const { getWebLiveProviderOverride } = await loadModule();
    expect(getWebLiveProviderOverride("flipex.pro")).toBeNull();
    expect(getWebLiveProviderOverride("athra.sbs")).toBeNull();
    expect(getWebLiveProviderOverride(null)).toBeNull();
  });
});

describe("migração + guards de blacklist para suportejetflix.site", () => {
  it("migração apaga apenas webIncompatibleLive antigo desse host", async () => {
    localStorage.setItem(
      "iptv.hostProfiles.v1",
      JSON.stringify({
        "suportejetflix.site": { webIncompatibleLive: true, disableHlsConversion: true, preferTs: true },
        "flipex.pro": { webIncompatibleLive: true },
      }),
    );
    const { getHostProfile } = await loadModule();
    expect(getHostProfile("suportejetflix.site").webIncompatibleLive).toBeUndefined();
    // outros campos preservados
    expect(getHostProfile("suportejetflix.site").disableHlsConversion).toBe(true);
    // outros hosts intactos
    expect(getHostProfile("flipex.pro").webIncompatibleLive).toBe(true);
  });

  it("rememberWebIncompatibleLive NÃO persiste para host com override", async () => {
    const { rememberWebIncompatibleLive, getHostProfile } = await loadModule();
    rememberWebIncompatibleLive("suportejetflix.site");
    expect(getHostProfile("suportejetflix.site").webIncompatibleLive).toBeUndefined();
  });

  it("rememberWebIncompatibleLive continua persistindo para outros hosts", async () => {
    const { rememberWebIncompatibleLive, getHostProfile } = await loadModule();
    rememberWebIncompatibleLive("exemplo-outro.tv");
    expect(getHostProfile("exemplo-outro.tv").webIncompatibleLive).toBe(true);
  });

  it("rememberHlsUnsupported NÃO torna suportejetflix.site TS-only globalmente", async () => {
    const { rememberHlsUnsupported, getHostProfile } = await loadModule();
    // limpa preset built-in que já vem TS-only, para provar o guard
    localStorage.setItem("iptv.hostProfiles.v1", JSON.stringify({ "suportejetflix.site": {} }));
    const mod = await loadModule();
    mod.rememberHlsUnsupported("suportejetflix.site");
    expect(mod.getHostProfile("suportejetflix.site").disableHlsConversion).toBeFalsy();
    expect(mod.getHostProfile("suportejetflix.site").preferTs).toBeFalsy();
    // referência pra evitar unused warning
    void rememberHlsUnsupported;
    void getHostProfile;
  });

  it("rememberHlsUnsupported continua persistindo para outros hosts", async () => {
    const { rememberHlsUnsupported, getHostProfile } = await loadModule();
    rememberHlsUnsupported("provedor-qualquer.tv");
    expect(getHostProfile("provedor-qualquer.tv").disableHlsConversion).toBe(true);
    expect(getHostProfile("provedor-qualquer.tv").preferTs).toBe(true);
  });
});
