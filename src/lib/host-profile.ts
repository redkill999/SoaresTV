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
  /** APENAS LIVE/APK: abrir direto no ExoPlayer nativo para evitar WebView/proxy. */
  forceNativeForLive?: boolean;
  /**
   * APENAS LIVE/Web: porta HTTPS oficial do provedor (server_info.https_port do
   * Xtream). Quando definida E a página está em HTTPS, o VideoPlayer prepende
   * uma variante `https://<host>:<httpsPort>/<path>` como primeiro candidato,
   * evitando o proxy /api/stream (cujo IP frequentemente é bloqueado pelo CDN do
   * provedor) e ao mesmo tempo respeitando a política de mixed-content do browser.
   */
  httpsPort?: number;
  /**
   * APENAS LIVE/Web: provedor comprovadamente incompatível com reprodução via
   * navegador desktop — o CDN redireciona para host sem CORS e/ou bloqueia IPs
   * do proxy edge. Web mostra aviso claro; APK ignora (ExoPlayer funciona).
   */
  webIncompatibleLive?: boolean;
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
  // Lista validada estável (canais, filmes e séries OK em web + APK).
  // Mantém HTTP original e pula proxy para evitar regressões.
  "ultrapremium.live": {
    disableProxy: true,
    forceHttp: true,
    bypassProxyForLive: true,
    disableHlsConversion: true,
    preferTs: true,
  },
  // athra.sbs: painel bloqueia IPs de datacenter. Mantemos proxy ATIVO
  // (não setar disableProxy/forceHttp aqui — quebra login/lista). Só pedimos
  // bypass do proxy para LIVE no APK e preferência por TS original.
  "athra.sbs": {
    bypassProxyForLive: true,
    disableHlsConversion: true,
    preferTs: true,
    forceNativeForLive: true,
  },
  // suportejetflix.site: validado funcional em web desktop (canais + filmes).
  // Mantém proxy ativo (necessário p/ CORS no browser) e prioriza TS original
  // sem conversão HLS forçada.
  "suportejetflix.site": {
    disableHlsConversion: true,
    preferTs: true,
  },
  // flipex.pro: origem OK mas os canais LIVE redirecionam (302) para um CDN
  // (eagflix.lat) que bloqueia IPs de datacenter/edge (404 no proxy) e não
  // envia CORS (bloqueio direto no browser). Confirmadamente NÃO reproduz no
  // Web Desktop; funciona normalmente no APK via ExoPlayer nativo.
  "flipex.pro": {
    forceHttp: true,
    bypassProxyForLive: true,
    webIncompatibleLive: true,
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
// Limpeza pontual: preset anterior de athra.sbs marcou disableProxy/forceHttp
// e quebrou o login no APK. Remove essas flags se vieram do storage.
if (memory["athra.sbs"]) {
  const cur = memory["athra.sbs"];
  if (cur.disableProxy || cur.forceHttp) {
    const { disableProxy: _dp, forceHttp: _fh, ...rest } = cur;
    memory["athra.sbs"] = rest;
    writeStorage(memory);
    console.log("[HOST PROFILE] limpou flags quebradas de athra.sbs");
  }
}
// Limpeza pontual: versões anteriores marcaram flipex.pro como TS-only. Teste
// real mostrou que canais ativos desse host tocam via HLS; manter essas flags
// persistidas faz o Web Desktop cair em MPEG-TS antes da playlist funcional.
if (memory["flipex.pro"]?.disableHlsConversion || memory["flipex.pro"]?.preferTs || memory["flipex.pro"]?.httpsPort) {
  const cur = memory["flipex.pro"];
  const { disableHlsConversion: _dh, preferTs: _pt, httpsPort: _hp, ...rest } = cur;
  memory["flipex.pro"] = rest;
  writeStorage(memory);
  console.log("[HOST PROFILE] limpou flags TS-only quebradas de flipex.pro");
}
// Limpeza pontual (05/07): uma versão com bug de rememberWebIncompatibleLive
// gravou forceNativeForLive/bypassProxyForLive junto de webIncompatibleLive em
// hosts do usuário durante falhas no APK — isso forçava ExoPlayer para LIVE e
// quebrava os canais. Remove essas flags aprendidas; o app reaprende se for o
// caso real (presets built-in são re-aplicados logo abaixo e não são afetados).
{
  let cleaned = false;
  for (const [host, prof] of Object.entries(memory)) {
    if (prof?.webIncompatibleLive && (prof.forceNativeForLive || prof.bypassProxyForLive)) {
      const { webIncompatibleLive: _w, forceNativeForLive: _f, bypassProxyForLive: _b, ...rest } = prof;
      memory[host] = rest;
      cleaned = true;
    }
  }
  if (cleaned) {
    writeStorage(memory);
    console.log("[HOST PROFILE] limpou flags webIncompatibleLive/forceNativeForLive gravadas por bug");
  }
}
// Limpeza pontual: multop100.top foi marcado por tentativas anteriores como
// TS-only / ExoPlayer. O diagnóstico mostrou que ExoPlayer não abre e o TS
// encerra em ~30s; portanto esse host deve voltar ao padrão HLS-first via proxy.
if (memory["multop100.top"]?.forceNativeForLive || memory["multop100.top"]?.disableHlsConversion || memory["multop100.top"]?.preferTs || memory["multop100.top"]?.bypassProxyForLive) {
  const cur = memory["multop100.top"];
  const {
    forceNativeForLive: _fn,
    disableHlsConversion: _dh,
    preferTs: _pt,
    bypassProxyForLive: _bp,
    ...rest
  } = cur;
  memory["multop100.top"] = rest;
  writeStorage(memory);
  console.log("[HOST PROFILE] limpou flags quebradas de multop100.top");
}
// Aplica presets built-in (HOST_PRESETS). Patches em runtime continuam

// sobrescrevendo: preset → storage → updateHostProfile.
for (const [host, preset] of Object.entries(HOST_PRESETS)) {
  memory[host] = { ...preset, ...memory[host] };
}
// Override obrigatório: este host NÃO pode manter flags salvas de TS-only nem
// forceNativeForLive, porque isso quebrou a abertura dos canais no APK.
if (memory["multop100.top"]) {
  const cur = memory["multop100.top"];
  const {
    forceNativeForLive: _fn,
    disableHlsConversion: _dh,
    preferTs: _pt,
    bypassProxyForLive: _bp,
    ...rest
  } = cur;
  memory["multop100.top"] = rest;
  writeStorage(memory);
}
// flipex.pro não responde HTTPS no host do painel. Overrides antigos/salvos de
// forceHttps/forceHttp=false quebram LIVE e VOD no Web Desktop; este preset é
// intencionalmente mandatório para restaurar o comportamento HTTP funcional.
memory["flipex.pro"] = { ...memory["flipex.pro"], forceHttp: true, bypassProxyForLive: true };
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
  const h = host.toLowerCase();
  if (memory[h]) return memory[h];
  // Presets como "athra.sbs" precisam valer também quando o Xtream gera URLs
  // com porta explícita (ex.: athra.sbs:80 / :8080). Sem este fallback, o APK
  // não ativava forceNativeForLive nem o diagnóstico visual para canais LIVE.
  const withoutPort = h.replace(/:\d+$/, "");
  if (memory[withoutPort]) return memory[withoutPort];
  const withoutWww = withoutPort.replace(/^www\./, "");
  if (memory[withoutWww]) return memory[withoutWww];
  const suffixPreset = Object.keys(HOST_PRESETS).find((presetHost) => withoutWww.endsWith(`.${presetHost}`));
  return suffixPreset ? memory[suffixPreset] ?? {} : {};
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
 * 424 = o próprio proxy /api/stream rebaixa 5xx do upstream para Failed
 * Dependency (evita disparar o runtime-error boundary). Tratamos igual.
 */
export function isProxyDeadStatus(status: number | string | null | undefined): boolean {
  const s = Number(status);
  return s === 502 || s === 503 || s === 504 || s === 424;
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

/** Marca o host como incompatível com a variante HLS (.m3u8 404/410):
 *  futuros canais desse provedor pulam direto pro .ts via mpegts.js. */
export function rememberHlsUnsupported(host: string): void {
  updateHostProfile(host, { disableHlsConversion: true, preferTs: true });
}

/** Marca host cuja reprodução LIVE não funciona em navegador desktop.
 *  IMPORTANTE: só marca webIncompatibleLive. NÃO setar forceNativeForLive/
 *  bypassProxyForLive aqui — isso forçava ExoPlayer para LIVE no APK e
 *  quebrou os canais (o pipeline web via proxy é o caminho que funciona). */
export function rememberWebIncompatibleLive(host: string): void {
  updateHostProfile(host, { webIncompatibleLive: true });
}



