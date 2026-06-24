// =========================================================================
// Gerenciador central de perfil por host IPTV.
//
// Mantém, de forma PERSISTENTE, características aprendidas em runtime sobre
// cada host (proxy quebrado, HTTPS quebrado, player que funcionou). Esses
// dados são consultados pelo VideoPlayer antes de montar a fila de
// tentativas, evitando que cada login redescubra os mesmos problemas.
//
// Persistência: localStorage (síncrono, fonte da verdade) + Capacitor
// Preferences (write-through best-effort para APK, sobrevive a limpeza de
// WebView cache). A leitura sempre usa localStorage para ser síncrona.
//
// Migra automaticamente as chaves antigas:
//   - iptv.bypass503Hosts.v1  → disableProxy=true + forceHttp=true
//   - iptv.noHttpsHosts.v1    → forceHttp=true
//
// NÃO contém lógica de player — só dados. O VideoPlayer interpreta.
// =========================================================================

export type PlaybackStrategy = "exo-native" | "mpegts" | "html5" | "hls";

export type HostProfile = {
  /** Proxy /api/stream responde 5xx para esse host — pular direto pra origem. */
  disableProxy?: boolean;
  /** Host não aceita HTTPS — manter http original, nunca promover. */
  forceHttp?: boolean;
  /** Estratégia que efetivamente iniciou a reprodução pela última vez. */
  preferPlayer?: PlaybackStrategy;
  /**
   * APENAS LIVE: pular proxy /api/stream para canais ao vivo e ir direto à origem.
   * VOD continua usando proxy. Útil para painéis cujos canais quebram quando
   * passam pelo proxy (rate-limit, range requests, headers reescritos).
   */
  bypassProxyForLive?: boolean;
  /**
   * APENAS LIVE: NÃO converter `.ts` para `.m3u8` automaticamente. Tentar o
   * `.ts` original primeiro. Painéis que não expõem variante HLS retornam 404
   * em todos os UAs e o hls.js gasta segundos antes de desistir.
   */
  disableHlsConversion?: boolean;
  /** APENAS LIVE: priorizar candidato `.ts` sobre `.m3u8`. */
  preferTs?: boolean;
  /** Última atualização (ms epoch). */
  updatedAt?: number;
};

/**
 * Presets built-in: hosts conhecidamente problemáticos onde já sabemos a
 * configuração ótima sem precisar aprender em runtime. Aplicado no boot,
 * mas qualquer mudança feita via `updateHostProfile` em runtime tem prioridade
 * (merge: preset → storage → patches em runtime).
 */
const HOST_PRESETS: Record<string, HostProfile> = {
  "esma26.top": {
    bypassProxyForLive: true,
    disableHlsConversion: true,
    preferTs: true,
  },
};

const STORAGE_KEY = "iptv.hostProfiles.v1";
// Chaves legadas migradas no boot.
const LEGACY_BYPASS = "iptv.bypass503Hosts.v1";
const LEGACY_NOHTTPS = "iptv.noHttpsHosts.v1";

type ProfileMap = Record<string, HostProfile>;

function readStorage(): ProfileMap {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ProfileMap;
    }
  } catch { /* noop */ }
  return {};
}

function writeStorage(map: ProfileMap): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }
  } catch { /* noop */ }
  // Write-through best-effort para Capacitor Preferences (APK). Async,
  // não bloqueia a UI; se o plugin não existir ou falhar, ignoramos.
  void (async () => {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(map) });
    } catch { /* plugin ausente ou ambiente web: ok */ }
  })();
}

function migrateLegacyOnce(map: ProfileMap): ProfileMap {
  if (typeof localStorage === "undefined") return map;
  let mutated = false;
  try {
    const bypass = localStorage.getItem(LEGACY_BYPASS);
    if (bypass) {
      const arr = JSON.parse(bypass);
      if (Array.isArray(arr)) {
        for (const h of arr) {
          if (typeof h !== "string") continue;
          const host = h.toLowerCase();
          map[host] = { ...map[host], disableProxy: true, forceHttp: true, updatedAt: Date.now() };
          mutated = true;
        }
      }
      localStorage.removeItem(LEGACY_BYPASS);
    }
  } catch { /* noop */ }
  try {
    const nohttps = localStorage.getItem(LEGACY_NOHTTPS);
    if (nohttps) {
      const arr = JSON.parse(nohttps);
      if (Array.isArray(arr)) {
        for (const h of arr) {
          if (typeof h !== "string") continue;
          const host = h.toLowerCase();
          map[host] = { ...map[host], forceHttp: true, updatedAt: Date.now() };
          mutated = true;
        }
      }
      localStorage.removeItem(LEGACY_NOHTTPS);
    }
  } catch { /* noop */ }
  if (mutated) {
    writeStorage(map);
    console.log("[HOST PROFILE] perfis legados migrados", { total: Object.keys(map).length });
  }
  return map;
}

// Cache em memória — leitura síncrona, escrita propaga pro storage.
const memory: ProfileMap = migrateLegacyOnce(readStorage());
// Aplica presets built-in (HOST_PRESETS). Patches em runtime continuam
// sobrescrevendo: preset → storage → updateHostProfile.
for (const [host, preset] of Object.entries(HOST_PRESETS)) {
  memory[host] = { ...preset, ...memory[host] };
}
if (Object.keys(memory).length) {
  console.log("[HOST PROFILE] perfis carregados", {
    hosts: Object.keys(memory),
  });
}

export function hostOf(url: string): string | null {
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

export function getHostProfile(host: string | null | undefined): HostProfile {
  if (!host) return {};
  return memory[host.toLowerCase()] ?? {};
}

export function updateHostProfile(host: string, patch: Partial<HostProfile>): HostProfile {
  if (!host) return {};
  const h = host.toLowerCase();
  const current = memory[h] ?? {};
  // Só persiste se algo mudou de fato (evita escrita inútil).
  let changed = false;
  for (const k of Object.keys(patch) as (keyof HostProfile)[]) {
    if (patch[k] !== undefined && patch[k] !== current[k]) { changed = true; break; }
  }
  if (!changed) return current;
  const next: HostProfile = { ...current, ...patch, updatedAt: Date.now() };
  memory[h] = next;
  writeStorage(memory);
  console.log("[HOST PROFILE] atualizado", { host: h, perfil: next });
  return next;
}

// =========================================================================
// Helpers de alto nível usados pelo VideoPlayer.
// =========================================================================

/**
 * Detecta se um status HTTP é um sintoma de proxy quebrado pra esse host.
 * 502/503/504 indicam que o proxy não consegue alcançar o upstream — não
 * adianta insistir, vamos direto.
 */
export function isProxyDeadStatus(status: number | string | null | undefined): boolean {
  const s = Number(status);
  return s === 502 || s === 503 || s === 504;
}

export function rememberProxyDead(host: string, status: number | string): void {
  updateHostProfile(host, { disableProxy: true, forceHttp: true });
  console.log("[HOST PROFILE] proxy desabilitado para host", { host, status });
}

export function rememberHttpsFailure(host: string): void {
  updateHostProfile(host, { forceHttp: true });
}

export function rememberPreferredPlayer(host: string, strategy: PlaybackStrategy): void {
  updateHostProfile(host, { preferPlayer: strategy });
}
