import { isNativeAppSync } from "@/lib/platform";

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
  /** APENAS LIVE/WebView HTTPS: tentar variantes HTTPS antes de proxy/HTTP. */
  preferHttpsForLive?: boolean;
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
  /**
   * APENAS LIVE/Web: host já foi observado abrindo LIVE rapidamente (primeiro
   * frame < 12s) com o pipeline HLS padrão. Nas próximas aberturas o VideoPlayer
   * usa `liveSyncDurationCount: 3 / liveMaxLatencyDurationCount: 10` (default do
   * hls.js) em vez do baseline conservador 4/12, cortando ~5s no start-up.
   * Se der erro fatal antes do primeiro frame, o flag é limpo automaticamente
   * (aprende-desaprende). NUNCA aplicado a hosts `isLockedHlsFirstLiveHost`.
   */
  liveFastStart?: boolean;
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
  // Lista DNS Ultra Premium. Painel aceita HTTPS (confirmado 200).
  // NÃO usar forceHttp: com página HTTPS (APK/Web) o browser bloqueia
  // mixed-content e o hls.js/mpegts nem chega a fetchar o stream —
  // reproduz "ETAPA 8.6 WARN mixed-content". VOD funciona com proxy
  // fallback; LIVE precisa ir direto em HTTPS.
  "ultrapremium.live": {
    disableProxy: true,
    bypassProxyForLive: true,
    disableHlsConversion: true,
    preferTs: true,
    preferHttpsForLive: true,
  },
  // athra.sbs: painel bloqueia IPs de datacenter. Mantemos proxy ATIVO
  // (não setar disableProxy/forceHttp aqui — quebra login/lista). Só pedimos
  // bypass do proxy para LIVE no APK e preferência por TS original.
  "athra.sbs": {
    bypassProxyForLive: true,
    disableHlsConversion: true,
    preferTs: true,
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


function hostKeyMatchesBase(host: string, base: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
  return h === base || h.endsWith(`.${base}`);
}


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
// Limpeza APK-only: builds anteriores podiam "aprender" ExoPlayer forçado em
// qualquer host LIVE após uma travada. Isso persiste no celular e faz os canais
// abrirem pelo caminho nativo que já sabemos ser instável em muitos painéis,
// enquanto filmes/séries continuam funcionando. Remove apenas essa contaminação
// no APK; navegador desktop fica intocado.
if (isNativeAppSync()) {
  let cleanedApkNativeForce = false;
  for (const [host, prof] of Object.entries(memory)) {
    if (!prof?.forceNativeForLive) continue;
    const {
      forceNativeForLive: _fn,
      bypassProxyForLive: _bp,
      disableHlsConversion: _dh,
      preferTs: _pt,
      ...rest
    } = prof;
    memory[host] = rest;
    cleanedApkNativeForce = true;
  }
  if (cleanedApkNativeForce) {
    writeStorage(memory);
    console.log("[HOST PROFILE] APK limpou forceNativeForLive aprendido automaticamente");
  }
}
// Limpeza/override pontual: builds anteriores podiam salvar o perfil com porta
// explícita (ultrapremium.live:80). Como getHostProfile usa match exato antes
// do preset sem porta, esse registro antigo mantinha forceHttp e/ou perdia
// preferHttpsForLive, fazendo LIVE cair em mixed-content no APK. Para esta DNS,
// o preset HTTPS é obrigatório em todas as variações do host.
{
  let cleanedUltraPremium = false;
  const ultraPreset = HOST_PRESETS["ultrapremium.live"];
  for (const [host, prof] of Object.entries(memory)) {
    if (!hostKeyMatchesBase(host, "ultrapremium.live")) continue;
    const {
      forceHttp: _fh,
      forceNativeForLive: _fn,
      webIncompatibleLive: _wi,
      ...rest
    } = prof;
    memory[host] = { ...rest, ...ultraPreset, updatedAt: prof.updatedAt ?? Date.now() };
    cleanedUltraPremium = true;
  }
  if (cleanedUltraPremium) {
    writeStorage(memory);
    console.log("[HOST PROFILE] normalizou ultrapremium.live para HTTPS LIVE");
  }
}
// Baseline validada: cdnchurras.space/Space FHD funciona no Web Desktop pelo
// HLS-first via proxy. Tentativas anteriores de TS-first/webIncompatible/HTTPS
// quebraram esse canal; removemos qualquer memória persistida que desvie disso.
if (memory["cdnchurras.space"]?.forceNativeForLive || memory["cdnchurras.space"]?.disableHlsConversion || memory["cdnchurras.space"]?.preferTs || memory["cdnchurras.space"]?.bypassProxyForLive || memory["cdnchurras.space"]?.disableProxy || memory["cdnchurras.space"]?.webIncompatibleLive || memory["cdnchurras.space"]?.httpsPort) {
  const cur = memory["cdnchurras.space"];
  const {
    forceNativeForLive: _fn,
    disableHlsConversion: _dh,
    preferTs: _pt,
    bypassProxyForLive: _bp,
    disableProxy: _dp,
    webIncompatibleLive: _wi,
    httpsPort: _hp,
    ...rest
  } = cur;
  memory["cdnchurras.space"] = rest;
  writeStorage(memory);
  console.log("[HOST PROFILE] limpou flags quebradas de cdnchurras.space");
}
// Aplica presets built-in (HOST_PRESETS). Patches em runtime continuam

// sobrescrevendo: preset → storage → updateHostProfile.
for (const [host, preset] of Object.entries(HOST_PRESETS)) {
  memory[host] = { ...preset, ...memory[host] };
}
// Garante que variações com porta/subdomínio de ultrapremium.live também herdem
// o preset obrigatório; sem isso, `ultrapremium.live:80` continua usando o
// perfil salvo antigo e o APK tenta http:// em página HTTPS.
for (const [host, prof] of Object.entries(memory)) {
  if (!hostKeyMatchesBase(host, "ultrapremium.live")) continue;
  const { forceHttp: _fh, forceNativeForLive: _fn, webIncompatibleLive: _wi, ...rest } = prof;
  memory[host] = { ...rest, ...HOST_PRESETS["ultrapremium.live"] };
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

// Normaliza a chave de host usada em memory[]. Compartilhado entre leitura e
// escrita para evitar fragmentação (ex.: "painel.com:8080" e "painel.com"
// virando entradas separadas — causa histórica de 5+ hotfixes manuais neste
// arquivo). Só remove porta e prefixo www — não altera subdomínios reais.
function normalizeHostKey(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
}

export function getHostProfile(host: string | null | undefined): HostProfile {
  if (!host) return {};
  const h = host.toLowerCase();
  // 1) match exato (mantém compat com chaves antigas já persistidas com porta)
  if (memory[h]) return memory[h];
  // 2) match normalizado (chave canônica após esta correção)
  const normalized = normalizeHostKey(h);
  if (normalized !== h && memory[normalized]) return memory[normalized];
  // 3) fallbacks legados (sem porta / sem www isoladamente) — preservados
  const withoutPort = h.replace(/:\d+$/, "");
  if (memory[withoutPort]) return memory[withoutPort];
  const withoutWww = withoutPort.replace(/^www\./, "");
  if (memory[withoutWww]) return memory[withoutWww];
  const suffixPreset = Object.keys(HOST_PRESETS).find((presetHost) => withoutWww.endsWith(`.${presetHost}`));
  return suffixPreset ? memory[suffixPreset] ?? {} : {};
}

export function updateHostProfile(host: string, patch: Partial<HostProfile>): HostProfile {
  if (!host) return {};
  // Escrita SEMPRE na chave normalizada. Isso elimina a fragmentação em que
  // "host:8080", "host:80" e "host" geravam três perfis distintos — cada um
  // aprendendo liveFastStart/preferTs/etc. de forma isolada.
  const h = normalizeHostKey(host);
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


// =========================================================================
// VOD Force-Native learning (BUG 1)
//
// Aprende, por assinatura estável, quais VODs (filmes/séries) falham no
// <video> WebView com code=4 apesar de o container ser um MP4 válido —
// tipicamente HEVC/AV1/AC3. Após 2 falhas confirmadas, os próximos playbacks
// que baterem a mesma assinatura já abrem no ExoPlayer nativo. Se o
// ExoPlayer também falhar, o aprendizado é apagado (rollback), evitando
// loops. Só se aplica a APK + VOD.
//
// Assinatura (ordem de prioridade):
//   1) host + streamId + container + codec + mime
//   2) host + container + codec + mime           (sem streamId confiável)
//   3) host + container + mime                    (sem codec confiável)
//
// mp4Brand (ftyp) NÃO entra na assinatura em hipótese alguma — é armazenado
// apenas como metadado de telemetria.
// =========================================================================

const VOD_FORCE_NATIVE_KEY = "iptv.vodForceNative.v1";
const VOD_FORCE_NATIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const VOD_FORCE_NATIVE_MIN_HITS = 2;

export type VodForceNativeSignature = {
  host: string;
  streamId?: string;
  container: string;
  codec?: string;
  mime: string;
};

export type VodForceNativeRecord = {
  sig: VodForceNativeSignature;
  hits: number;
  firstFailAt: number;
  lastFailAt: number;
  expiresAt: number;
  mp4Brand?: string;   // telemetria — não participa da chave
  lastReason?: string;
};

type VodForceNativeMap = Record<string, VodForceNativeRecord>;

/** Chave estável para dedupe/lookup. mp4Brand nunca entra aqui. */
export function vodSignatureKey(sig: VodForceNativeSignature): string {
  const host = sig.host || "-";
  const sid = sig.streamId ? sig.streamId : "-";
  const container = sig.container || "-";
  const codec = sig.codec ? sig.codec : "-";
  const mime = (sig.mime || "-").toLowerCase();
  return `${host}|${sid}|${container}|${codec}|${mime}`;
}

function readVodForceNative(): VodForceNativeMap {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(VOD_FORCE_NATIVE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as VodForceNativeMap;
  } catch { /* noop */ }
  return {};
}

function writeVodForceNative(map: VodForceNativeMap): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(VOD_FORCE_NATIVE_KEY, JSON.stringify(map));
    }
  } catch { /* noop */ }
  void (async () => {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.set({ key: VOD_FORCE_NATIVE_KEY, value: JSON.stringify(map) });
    } catch { /* plugin ausente: ok */ }
  })();
}

function pruneExpired(map: VodForceNativeMap): VodForceNativeMap {
  const now = Date.now();
  let mutated = false;
  for (const [k, rec] of Object.entries(map)) {
    if (!rec || typeof rec.expiresAt !== "number" || rec.expiresAt <= now) {
      delete map[k];
      mutated = true;
    }
  }
  if (mutated) writeVodForceNative(map);
  return map;
}

const vodForceNativeMemory: VodForceNativeMap = pruneExpired(readVodForceNative());

/**
 * Registra uma falha VOD code=4 já confirmada como MP4 válido. Após 2 hits
 * o `shouldForceNativeVod` passa a retornar true para essa assinatura.
 * Só deve ser chamada em APK, para VOD, após confirmação de MP4 válido.
 */
export function recordVodNativeFailure(
  sig: VodForceNativeSignature,
  meta?: { mp4Brand?: string; reason?: string },
): VodForceNativeRecord {
  const key = vodSignatureKey(sig);
  const now = Date.now();
  const prev = vodForceNativeMemory[key];
  const next: VodForceNativeRecord = prev
    ? {
        sig,
        hits: prev.hits + 1,
        firstFailAt: prev.firstFailAt,
        lastFailAt: now,
        expiresAt: now + VOD_FORCE_NATIVE_TTL_MS,
        mp4Brand: meta?.mp4Brand ?? prev.mp4Brand,
        lastReason: meta?.reason ?? prev.lastReason,
      }
    : {
        sig,
        hits: 1,
        firstFailAt: now,
        lastFailAt: now,
        expiresAt: now + VOD_FORCE_NATIVE_TTL_MS,
        mp4Brand: meta?.mp4Brand,
        lastReason: meta?.reason,
      };
  vodForceNativeMemory[key] = next;
  writeVodForceNative(vodForceNativeMemory);
  console.log("[VOD FORCE NATIVE] falha registrada", { key, hits: next.hits });
  return next;
}

/**
 * Consulta pré-play: dado o contexto conhecido antes do playback, verifica
 * se algum registro ativo com hits>=2 casa com este VOD.
 *
 * Casamento:
 *  - record.sig.host === host (obrigatório)
 *  - se record.sig.streamId estiver definido e `ctx.streamId` também: devem ser iguais
 *  - se record.sig.streamId estiver definido e `ctx.streamId` NÃO: sem match
 *  - se record.sig.streamId estiver ausente: match cai para container (extensão)
 *    quando `ctx.container` estiver disponível; se não, não casa
 */
export function shouldForceNativeVod(
  ctx: { host: string | null | undefined; streamId?: string | null; container?: string | null },
): { match: true; key: string; record: VodForceNativeRecord } | { match: false } {
  const host = ctx.host?.toLowerCase();
  if (!host) return { match: false };
  const normalizedHost = normalizeHostKey(host);
  const now = Date.now();
  for (const [key, rec] of Object.entries(vodForceNativeMemory)) {
    if (!rec || rec.expiresAt <= now) continue;
    if (rec.hits < VOD_FORCE_NATIVE_MIN_HITS) continue;
    const recHost = normalizeHostKey(rec.sig.host);
    if (recHost !== normalizedHost) continue;
    if (rec.sig.streamId) {
      if (!ctx.streamId || String(ctx.streamId) !== rec.sig.streamId) continue;
      return { match: true, key, record: rec };
    }
    // Sem streamId no registro: exige match por container (inferido da extensão pré-play)
    if (!ctx.container) continue;
    if (rec.sig.container !== ctx.container) continue;
    return { match: true, key, record: rec };
  }
  return { match: false };
}

/** Rollback: remove um aprendizado específico (ex.: ExoPlayer também falhou). */
export function clearVodNativeLearning(key: string): void {
  if (!vodForceNativeMemory[key]) return;
  delete vodForceNativeMemory[key];
  writeVodForceNative(vodForceNativeMemory);
  console.log("[VOD FORCE NATIVE] aprendizado removido (rollback)", { key });
}

/**
 * Limpa TODO o aprendizado VOD force-native (localStorage + Preferences).
 * Usado para descontaminar instalações que acumularam registros errados
 * pelo experimento BUG 1, agora revertido.
 */
export function clearAllVodNativeLearning(): void {
  for (const k of Object.keys(vodForceNativeMemory)) delete vodForceNativeMemory[k];
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(VOD_FORCE_NATIVE_KEY);
  } catch { /* noop */ }
  void (async () => {
    try {
      const { Preferences } = await import("@capacitor/preferences");
      await Preferences.remove({ key: VOD_FORCE_NATIVE_KEY });
    } catch { /* noop */ }
  })();
}


/** Extrai um FourCC de codec de vídeo confiável do parâmetro `codecs` do Content-Type. */
export function extractVideoCodecFromContentType(contentType: string | null | undefined): string | undefined {
  if (!contentType) return undefined;
  const m = contentType.match(/codecs\s*=\s*"?([^";]+)"?/i);
  if (!m) return undefined;
  const list = m[1].split(",").map((s) => s.trim().toLowerCase());
  for (const c of list) {
    if (/^(avc1|hvc1|hev1|av01|vp09|vp9)(\.|$)/.test(c)) {
      return c.split(".")[0];
    }
  }
  return undefined;
}

/** Mapeia extensão do path para container canônico (mesmos rótulos do detector de bytes). */
export function containerFromExtension(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const path = new URL(url, typeof location !== "undefined" ? location.origin : "http://x").pathname.toLowerCase();
    if (/\.(mp4|m4v|mov)(\?|$)/.test(path)) return "mp4";
    if (/\.mkv(\?|$)/.test(path)) return "mkv";
    if (/\.webm(\?|$)/.test(path)) return "webm";
    if (/\.ts(\?|$)/.test(path)) return "mp2t";
    if (/\.avi(\?|$)/.test(path)) return "riff";
    if (/\.flv(\?|$)/.test(path)) return "flv";
  } catch { /* noop */ }
  return undefined;
}




