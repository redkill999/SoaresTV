import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { isNativeApp } from "@/lib/xtream";
import { playNative, stopNative } from "@/lib/native-player";
import { store, getCompatForUrl, USER_AGENT_STRINGS, type AppSettings, type ListCompat } from "@/lib/storage";

// Module-level cache do mpegts.js: a 1ª troca de canal paga o import, as
// seguintes reusam a mesma referência (sem reparse de bundle nem nova Promise).
let mpegtsModule: typeof import("mpegts.js").default | null = null;
let mpegtsLoading: Promise<typeof import("mpegts.js").default> | null = null;

// ===== [503 BYPASS] memória persistida ====================================
// Hosts (ex.: "esma26.top") cujo proxy /api/stream respondeu 503 ao menos
// uma vez. Persistido em localStorage para sobreviver a logout/reload.
// Para esses hosts priorizamos candidatos diretos (sem proxy) já na próxima
// reprodução. Não altera nada para hosts que continuam funcionando via proxy.
const PERSIST_KEY_BYPASS = "iptv.bypass503Hosts.v1";
// ===== [HTTPS SKIP] whitelist de hosts IPTV sem HTTPS =====================
// Hosts cuja variante https falhou. Para eles, jamais promovemos http→https
// (nem como candidato alternativo). Persistido.
const PERSIST_KEY_NOHTTPS = "iptv.noHttpsHosts.v1";

function loadPersistedHosts(key: string): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
  } catch { /* noop */ }
  return [];
}
function persistHosts(key: string, set: Set<string>) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch { /* noop */ }
}

const bypass503Hosts = new Set<string>(loadPersistedHosts(PERSIST_KEY_BYPASS));
const noHttpsHosts = new Set<string>(loadPersistedHosts(PERSIST_KEY_NOHTTPS));
if (bypass503Hosts.size) console.log("[PERSIST BYPASS] hosts carregados", { hosts: Array.from(bypass503Hosts) });
if (noHttpsHosts.size) console.log("[HTTPS SKIP] hosts carregados (sem HTTPS)", { hosts: Array.from(noHttpsHosts) });

function rememberBypass503(host: string) {
  if (!host || bypass503Hosts.has(host)) return;
  bypass503Hosts.add(host);
  persistHosts(PERSIST_KEY_BYPASS, bypass503Hosts);
  console.log("[PERSIST BYPASS] host salvo", { host });
  // Co-causa típica: o upstream também não aceita https. Marcamos para
  // nunca mais tentarmos promover http→https desse host.
  rememberNoHttps(host);
}
function rememberNoHttps(host: string) {
  if (!host || noHttpsHosts.has(host)) return;
  noHttpsHosts.add(host);
  persistHosts(PERSIST_KEY_NOHTTPS, noHttpsHosts);
  console.log("[HTTPS SKIP] host adicionado à whitelist sem-HTTPS", { host });
}

// ===== [BUFFER OPTIMIZATION] memória de estratégia por host ===============
// Estratégia que efetivamente começou a reproduzir num host. Usada para já
// abrir os próximos canais do mesmo painel pelo caminho que funcionou (evita
// retentativas e reduz tempo até primeiro frame). Sessão apenas.
export type PlaybackStrategy = "exo-native" | "html5" | "mpegts" | "hls";
const hostStrategy = new Map<string, PlaybackStrategy>();
function hostOf(u: string): string | null {
  try { return new URL(u).host.toLowerCase(); } catch { return null; }
}

async function loadMpegts() {
  if (mpegtsModule) return mpegtsModule;
  if (!mpegtsLoading) {
    mpegtsLoading = import("mpegts.js")
      .then((m) => {
        mpegtsModule = m.default;
        return mpegtsModule;
      })
      .catch((err) => {
        // Reseta para permitir nova tentativa na próxima troca de canal,
        // em vez de manter uma Promise rejeitada para sempre.
        mpegtsLoading = null;
        throw err;
      });
  }
  return mpegtsLoading;
}

type MpegTsPlayer = {
  destroy(): void;
  unload(): void;
  detachMediaElement(): void;
  pause(): void;
  attachMediaElement(mediaElement: HTMLMediaElement): void;
  load(): void;
  play(): Promise<void> | void;
  on(event: string, listener: (...args: unknown[]) => void): void;
};

async function lockLandscape() {
  try {
    const { ScreenOrientation } = await import("@capacitor/screen-orientation");
    await ScreenOrientation.lock({ orientation: "landscape" });
  } catch {
    // not native or plugin unavailable
  }
}

async function unlockOrientation() {
  try {
    const { ScreenOrientation } = await import("@capacitor/screen-orientation");
    await ScreenOrientation.unlock();
  } catch {
    // ignore
  }
}

// Xtream live URLs come as `.ts` (raw MPEG-TS), which browsers cannot decode
// natively. Most providers also expose an HLS variant at the same path with
// `.m3u8`. We try HLS first and fall back to the original on error. Everything
// flows through our /api/stream proxy to dodge CORS / mixed-content.
function toHlsCandidate(src: string, kind?: "live" | "vod"): string | null {
  if (kind === "vod" || /\/movie\/[^/]+\/[^/]+\//i.test(src) || /\/series\/[^/]+\/[^/]+\//i.test(src)) return null;
  if (/\.m3u8(\?|$)/i.test(src)) return src;
  // Apenas streams ao vivo têm variante HLS no Xtream.
  // VOD (movie/series) precisa ser reproduzido direto como mp4/mkv.
  if (/\/live\/[^/]+\/[^/]+\/\d+\.[a-z0-9]+(\?|$)/i.test(src)) {
    return src.replace(/\.[a-z0-9]+(\?|$)/i, ".m3u8$1");
  }
  return null;
}

function proxied(url: string, kind?: "live" | "vod"): string {
  return `/api/stream?u=${encodeURIComponent(url)}${kind === "vod" ? "&kind=vod" : ""}&v=6`;
}

function liveDirectCandidates(src: string): string[] {
  const out: string[] = [];
  const add = (url: string | null) => {
    if (url && !out.includes(url)) out.push(url);
  };
  if (/\.m3u8(\?|$)/i.test(src)) {
    add(src.replace(/\.m3u8(\?|$)/i, ".ts$1"));
  } else {
    add(src);
  }
  return out;
}

function httpsVariant(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return /^https:$/i.test(parsed.protocol) ? parsed.toString() : null;
    const host = parsed.host.toLowerCase();
    // [HTTPS SKIP] host marcado como IPTV sem HTTPS — manter http original.
    if (noHttpsHosts.has(host)) {
      console.log("[HTTPS SKIP] upgrade ignorado", { host, protocoloOriginal: "http", protocoloUtilizado: "http" });
      return null;
    }
    parsed.protocol = "https:";
    if (parsed.port === "80") parsed.port = "";
    return parsed.toString();
  } catch {
    return null;
  }
}


// Detecção automática do formato pela extensão da URL.
//   .m3u8 / .m3u  → "hls"   (hls.js no web, ExoPlayer nativo no APK)
//   .ts           → "ts"    (mpegts.js no web, ExoPlayer nativo no APK)
//   .mp4 / .m4v / .mov → "mp4" (<video> nativo do navegador)
//   .mkv          → "mkv"   (ExoPlayer nativo no APK; web tenta <video> mas
//                             a maioria dos browsers não decoda mkv)
//   sem extensão  → "auto"  (deixa a heurística atual decidir)
export type DetectedFormat = "hls" | "ts" | "mp4" | "mkv" | "auto";

export function detectFormat(url: string): DetectedFormat {
  try {
    const path = new URL(url, "http://x").pathname.toLowerCase();
    if (/\.m3u8?(?:$|\?)/.test(path)) return "hls";
    if (/\.ts(?:$|\?)/.test(path)) return "ts";
    if (/\.(mp4|m4v|mov)(?:$|\?)/.test(path)) return "mp4";
    if (/\.mkv(?:$|\?)/.test(path)) return "mkv";
    return "auto";
  } catch {
    return "auto";
  }
}

export function VideoPlayer({
  src,
  poster,
  kind,
  initialPosition,
  onProgress,
  controls = true,
}: {
  src: string;
  poster?: string;
  kind?: "live" | "vod";
  initialPosition?: number;
  onProgress?: (positionSec: number, durationSec: number) => void;
  controls?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // ===== Painel DEBUG VISUAL (apenas exibe; não interfere na reprodução) =====
  const [debugInfo, setDebugInfo] = useState<{
    canal: string;
    streamId: string;
    urlOriginal: string;
    urlFinal: string;
    formato: string;
    httpStatus: string;
    contentType: string;
    redirect: string;
    player: string;
    userAgent: string;
    motivo: string;
  } | null>(null);
  const [canManualPlay, setCanManualPlay] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => store.getAppSettings());
  // "deciding" = aguardando saber se rodaremos no ExoPlayer nativo (APK) ou no
  // <video>/MSE (web). "native" = plugin abriu overlay fullscreen, MSE inativo.
  // "web" = caminho clássico hls.js/mpegts.js.
  const [playerMode, setPlayerMode] = useState<"deciding" | "native" | "web">("deciding");
  const initialPositionRef = useRef(initialPosition ?? 0);
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    initialPositionRef.current = initialPosition ?? 0;
  }, [initialPosition]);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);
  useEffect(() => store.subscribeAppSettings(() => setSettings(store.getAppSettings())), []);

  // --- Decisão de player + ponte ExoPlayer ---------------------------------
  // No APK Android (Capacitor) tentamos o plugin nativo `capacitor-video-player`
  // que usa ExoPlayer/Media3 em overlay fullscreen, fora do WebView. Ganhos:
  //  - codecs HEVC/AC3/EAC3 com decoder de hardware (canais que travam no MSE
  //    do WebView geralmente rodam liso aqui)
  //  - MPEG-TS sem demux JS (sem mpegts.js)
  //  - headers customizados (User-Agent estilo XCIPTV) direto no request
  //  - bypassa o proxy /api/stream (vai direto pro painel via http)
  // Se o plugin falhar (plugin ausente, URL incompatível), caímos pro caminho
  // web (hls.js/mpegts) que continua existindo.
  const openNative = useCallback(async () => {
    const native = await isNativeApp();
    if (!native) return false;
    const compat = getCompatForUrl(src);
    const ua =
      compat.userAgent && compat.userAgent !== "auto"
        ? USER_AGENT_STRINGS[compat.userAgent]
        : "XCIPTV/7.0 (Linux; Android 13)";
    return playNative({
      url: src,
      userAgent: ua,
      startAtSec: kind !== "live" ? initialPositionRef.current : undefined,
      onExit: (pos) => {
        if (kind !== "live" && pos > 0) {
          // Duração real não vem do plugin; salvamos posição com duração
          // best-effort para o store de "Continuar assistindo".
          onProgressRef.current?.(pos, Math.max(pos + 1, pos));
        }
      },
    });
  }, [src, kind]);

  const shouldUseNativePlayer = settings.defaultPlayer === "exo";

  // Rastreia se o player nativo (ExoPlayer overlay) foi de fato aberto.
  // Sem isso, o cleanup chamava stopNative() em modo "web" também,
  // potencialmente matando outra instância do plugin.
  const nativeOpenedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPlayerMode("deciding");
    nativeOpenedRef.current = false;
    (async () => {
      const native = await isNativeApp();
      if (cancelled) return;
      if (!native) {
        setPlayerMode("web");
        return;
      }
      if (!shouldUseNativePlayer) {
        setPlayerMode("web");
        return;
      }
      const ok = await openNative();
      if (ok) nativeOpenedRef.current = true;
      if (cancelled) {
        if (ok) void stopNative();
        return;
      }
      setPlayerMode(ok ? "native" : "web");
    })();
    return () => {
      cancelled = true;
      // Só mata o ExoPlayer se ele foi realmente aberto por esta instância.
      if (nativeOpenedRef.current) {
        void stopNative();
        nativeOpenedRef.current = false;
      }
    };
  }, [src, kind, openNative, shouldUseNativePlayer]);

  const videoClass = useMemo(() => {
    const base = "h-full w-full bg-player";
    switch (settings.aspectRatio) {
      case "16:9":   return `${base} object-contain`;
      case "4:3":    return `${base} object-contain`;
      case "fill":   return `${base} object-cover`;
      case "stretch":return `${base} object-fill`;
      default:       return `${base} object-contain`;
    }
  }, [settings.aspectRatio]);

  useEffect(() => {
    // No APK, o ExoPlayer nativo cuida do playback — pulamos MSE.
    if (playerMode !== "web") return;
    const video = videoRef.current;
    if (!video || !src) return;
    setError(null);
    setDebugInfo(null);
    setCanManualPlay(false);

    // ---- Compatibilidade por lista ----------------------------------------
    // Resolve overrides salvos para o host desta URL (UA, transporte, formato,
    // upgrade HTTPS). Esses ajustes substituem o comportamento default.
    const compat: ListCompat = getCompatForUrl(src);
    const httpsSrc = compat.forceHttps ? httpsVariant(src) : null;
    const workingSrc = httpsSrc ?? src;
    const forcedUA = compat.userAgent && compat.userAgent !== "auto"
      ? USER_AGENT_STRINGS[compat.userAgent]
      : null;
    const proxiedX = (u: string, k?: "live" | "vod") =>
      forcedUA ? `${proxied(u, k)}&ua=${encodeURIComponent(forcedUA)}` : proxied(u, k);
    const forceProxy = compat.transport === "proxy";
    const forceDirect = compat.transport === "direct";
    // Detecção automática pelo sufixo da URL. Override do usuário (compat)
    // tem prioridade absoluta; só caímos na auto-detect quando ele não fixou.
    const auto = detectFormat(workingSrc);
    // No web desktop, manter HLS-first para `.ts` ao vivo (canais Xtream):
    // o provedor quase sempre expõe variante .m3u8 na mesma rota, e mpegts.js
    // direto falha em muitos painéis (CORS / codecs). Só pulamos HLS para
    // containers progressivos (mp4/mkv) ou quando o usuário forçou na Settings.
    const skipHls =
      compat.streamFormat === "ts" ||
      compat.streamFormat === "mp4" ||
      (compat.streamFormat == null && (auto === "mp4" || auto === "mkv"));

    const hlsCandidate = skipHls ? null : toHlsCandidate(workingSrc, kind);
    let hlsProxied: string | null = null;

    // Fallbacks de VOD: alguns provedores Xtream entregam o mesmo filme
    // em containers diferentes. Se o original falhar, tentamos .mp4 e .mkv.
    const isVod = kind === "vod" || /\/movie\/[^/]+\/[^/]+\//i.test(workingSrc) || /\/series\/[^/]+\/[^/]+\//i.test(workingSrc);
    const isLive = /\/live\/[^/]+\/[^/]+\//i.test(workingSrc);
    const vodCandidates: string[] = [];
    const vodMatch = workingSrc.match(/^(.*)\.([a-z0-9]+)(\?.*)?$/i);
    if (vodMatch && (!hlsCandidate || isVod)) {
      const [, base, ext, qs = ""] = vodMatch;
      const currentExt = ext.toLowerCase();
      // Quando o usuário força "mp4", prioriza containers progressivos.
      const preferred = compat.streamFormat === "mp4"
        ? ["mp4", "m4v", "mkv", currentExt]
        : isVod
          ? currentExt === "m3u8"
            ? ["m3u8", "mp4", "m4v", "mkv"]
            : [currentExt, "mp4", "m4v", "mkv", "m3u8"]
          : [currentExt, "mp4", "m4v", "mkv"];
      for (const alt of preferred) {
        const candidate = `${base}.${alt}${qs}`;
        if (!vodCandidates.includes(candidate)) vodCandidates.push(candidate);
      }
    }
    if (!vodCandidates.length) vodCandidates.push(workingSrc);
    const directCandidates = isLive ? liveDirectCandidates(workingSrc) : vodCandidates;
    const playbackCandidates = isVod
      ? vodCandidates.flatMap((url) => {
          const secure = httpsVariant(url);
          // Por padrão (web): proxy primeiro (https same-origin, sem mixed content).
          // forceDirect inverte: tenta direto antes; forceProxy: só proxy.
          let candidates: (string | null)[];
          if (forceDirect) {
            candidates = [secure, url, proxiedX(url, "vod"), secure ? proxiedX(secure, "vod") : null];
          } else if (forceProxy) {
            candidates = [proxiedX(url, "vod"), secure ? proxiedX(secure, "vod") : null];
          } else {
            candidates = [proxiedX(url, "vod"), secure ? proxiedX(secure, "vod") : null, secure];
          }
          return Array.from(new Set(candidates.filter(Boolean) as string[]));
        })
      : directCandidates.map((url) => proxiedX(url, kind));

    // ===== [503 BYPASS] — host já marcado nesta sessão =====================
    // Se já vimos esse host responder 503 antes, prioriza diretos.
    const srcHost = hostOf(workingSrc);
    if (srcHost && bypass503Hosts.has(srcHost) && !forceProxy) {
      const directs: string[] = [];
      for (const url of directCandidates) {
        directs.push(url);
        const secure = httpsVariant(url);
        if (secure) directs.push(secure);
      }
      const merged = Array.from(new Set([...directs, ...playbackCandidates]));
      playbackCandidates.splice(0, playbackCandidates.length, ...merged);
      console.log("[503 BYPASS] host previamente marcado — diretos priorizados", { host: srcHost, candidates: playbackCandidates });
    }


    // ===== [STREAM DEBUG] inicialização =====================================
    // Bloco puramente informativo. Não altera nenhuma lógica de reprodução —
    // só lista o que o player vai tentar e como (para diagnóstico de canais
    // que disparam "Não foi possível reproduzir este canal.").
    try {
      console.group("[STREAM DEBUG]");
      console.log("ETAPA 1 — Canal selecionado:", {
        src,
        streamIdInferido: (src.match(/\/(\d+)(?:\.[a-z0-9]+)?(?:\?|$)/i)?.[1]) ?? null,
        kind: kind ?? "(indef)",
      });
      console.log("ETAPA 2 — URL original (src recebido):", src);
      console.log("ETAPA 3 — URLs finais montadas (ordem de tentativa):", playbackCandidates);
      console.log("ETAPA 4 — Formato detectado:", detectFormat(workingSrc), {
        hlsCandidate,
        workingSrc,
        httpsForçado: !!httpsSrc,
      });
      console.log("ETAPA 8 — Estratégia inicial de player:", hlsCandidate ? "HLS (hls.js)" : "Direto (mpegts.js/HTML5/ExoPlayer)");
      console.log("ETAPA 9 — User-Agent forçado (compat):", forcedUA ?? "(auto: proxy cicla XCIPTV/TiviMate/IPTV Smarters/VLC/okhttp/…)");
      console.log("Compat resolvida para esta lista:", compat);
      console.log("Etapas 5/6/7 (HTTP Status, Content-Type, Redirects) serão impressas no relatório final via headers X-Upstream-*.");
      console.groupEnd();
    } catch { /* console pode não suportar group em algum runtime */ }


    let hls: Hls | null = null;
    let tsPlayer: MpegTsPlayer | null = null;
    let cancelled = false;
    let vodIdx = 0;
    let triedDirect = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let nativeDirect = false;
    let currentHlsUrl: string | null = null;
    // Estratégia de player atualmente em uso (alimenta o painel DEBUG VISUAL).
    let lastPlayerStrategy = "(indef)";
    let detachStallListeners: (() => void) | null = null;

    const clearWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    };

    const destroyTsPlayer = () => {
      if (!tsPlayer) return;
      try { tsPlayer.pause(); } catch { /* noop */ }
      try { tsPlayer.unload(); } catch { /* noop */ }
      try { tsPlayer.detachMediaElement(); } catch { /* noop */ }
      try { tsPlayer.destroy(); } catch { /* noop */ }
      tsPlayer = null;
    };

    const reportPlaybackFailure = async (reason: string) => {
      try {
        const currentUrl = playbackCandidates[Math.min(vodIdx, playbackCandidates.length - 1)] ?? workingSrc;
        const isProxy = currentUrl.startsWith("/api/stream");
        let probeStatus: number | string = "n/a";
        let upstreamStatus = "";
        let upstreamCt = "";
        let upstreamFinal = "";
        let upstreamUA = "";
        let upstreamOriginHdrs = "";
        let upstreamRedirected = "";
        if (isProxy) {
          try {
            const res = await fetch(currentUrl, { method: "HEAD" });
            probeStatus = res.status;
            upstreamStatus = res.headers.get("X-Upstream-Status") ?? "";
            upstreamCt = res.headers.get("X-Upstream-Content-Type") ?? "";
            upstreamFinal = res.headers.get("X-Upstream-Final-Url") ?? "";
            upstreamUA = res.headers.get("X-Upstream-User-Agent") ?? "";
            upstreamOriginHdrs = res.headers.get("X-Upstream-Origin-Headers") ?? "";
            upstreamRedirected = res.headers.get("X-Upstream-Redirected") ?? "";
          } catch (e) {
            probeStatus = `probe-fail: ${(e as Error).message}`;
          }
        }
        // eslint-disable-next-line no-console
        console.error("[player] RELATÓRIO DE FALHA DE REPRODUÇÃO", {
          motivo: reason,
          urlOriginal: src,
          urlTrabalho: workingSrc,
          urlFinalCliente: currentUrl,
          totalCandidatos: playbackCandidates.length,
          tentativaAtual: vodIdx,
          isLive,
          isVod,
          formato: detectFormat(workingSrc),
          forcedUA: forcedUA ?? "(auto)",
          httpStatusProxy: probeStatus,
          httpStatusUpstream: upstreamStatus,
          contentTypeUpstream: upstreamCt,
          urlFinalUpstream: upstreamFinal,
          uaUsadoUpstream: upstreamUA,
          headersOrigemReferer: upstreamOriginHdrs === "1",
          redirecionado: upstreamRedirected === "1",
          playerEstrategia: lastPlayerStrategy,
        });
        // Alimenta o painel DEBUG VISUAL na tela (APK sem acesso ao logcat).
        const streamId = (src.match(/\/(\d+)(?:\.[a-z0-9]+)?(?:\?|$)/i)?.[1]) ?? "(n/d)";
        const canalRotulo = (src.match(/\/live\/[^/]+\/[^/]+\/(\d+)/i)?.[1])
          ?? (src.match(/\/movie\/[^/]+\/[^/]+\/(\d+)/i)?.[1])
          ?? streamId;
        setDebugInfo({
          canal: canalRotulo,
          streamId,
          urlOriginal: src,
          urlFinal: upstreamFinal || currentUrl,
          formato: detectFormat(workingSrc),
          httpStatus: `proxy=${probeStatus} • upstream=${upstreamStatus || "n/d"}`,
          contentType: upstreamCt || "(n/d)",
          redirect: upstreamRedirected === "1" ? `sim → ${upstreamFinal}` : "não",
          player: lastPlayerStrategy,
          userAgent: upstreamUA || forcedUA || "(auto)",
          motivo: reason,
        });
      } catch {
        /* noop */
      }
    };


    // ===== [503 BYPASS] — detecta 503 do proxy e injeta candidatos diretos ==
    // Probe HEAD no candidato que acabou de falhar. Se for /api/stream e o
    // proxy/upstream retornou 503, marcamos o host na memória de sessão e
    // injetamos as variantes diretas (sem proxy) logo após a posição atual,
    // mantendo os demais como último recurso. Não toca em listas que funcionam.
    const maybeInject503Bypass = async () => {
      try {
        const failedUrl = playbackCandidates[vodIdx];
        // [HTTPS SKIP] Se o candidato que falhou era https de um host cuja
        // origem é http, marcamos o host para nunca mais promover.
        if (failedUrl) {
          const decoded = (() => { try { return decodeURIComponent(failedUrl.replace(/^.*?[?&]u=/, "")); } catch { return failedUrl; } })();
          const target = failedUrl.startsWith("/api/stream") ? decoded : failedUrl;
          try {
            const t = new URL(target);
            const original = new URL(workingSrc);
            if (t.protocol === "https:" && original.protocol === "http:" && t.host.toLowerCase() === original.host.toLowerCase()) {
              rememberNoHttps(t.host.toLowerCase());
            }
          } catch { /* noop */ }
        }
        if (!failedUrl || !failedUrl.startsWith("/api/stream")) return false;
        const res = await fetch(failedUrl, { method: "HEAD" });
        const upstream = res.headers.get("X-Upstream-Status") ?? "";
        const is503 = res.status === 503 || upstream === "503";
        if (!is503) return false;
        const host = hostOf(workingSrc);
        if (host) rememberBypass503(host);
        // Constrói diretos não presentes ainda na fila
        const directs: string[] = [];
        for (const u of directCandidates) {
          if (!playbackCandidates.includes(u)) directs.push(u);
          const secure = httpsVariant(u);
          if (secure && !playbackCandidates.includes(secure)) directs.push(secure);
        }

        if (!directs.length) {
          console.log("[503 BYPASS] proxy falhou (503) — sem diretos novos para injetar", { host, failedUrl });
          return false;
        }
        playbackCandidates.splice(vodIdx + 1, 0, ...directs);
        console.log("[503 BYPASS] proxy falhou (503) — tentando conexão direta", {
          host,
          urlProxyFalhou: failedUrl,
          diretosInjetados: directs,
          ordemAtualizada: playbackCandidates,
        });
        return true;
      } catch (e) {
        console.log("[503 BYPASS] probe HEAD falhou", { erro: (e as Error).message });
        return false;
      }
    };

    const tryNextVod = () => {
      clearWatchdog();
      if (hls) {
        hls.destroy();
        hls = null;
      }
      destroyTsPlayer();
      // Tenta bypass 503 antes de avançar. Se injetar diretos, eles entram
      // logo após vodIdx; ao incrementar, cairemos no primeiro direto.
      void maybeInject503Bypass().finally(() => {
        vodIdx += 1;
        if (vodIdx < playbackCandidates.length) {
          const next = playbackCandidates[vodIdx];
          if (next && !next.startsWith("/api/stream")) {
            console.log("[503 BYPASS] próxima tentativa via URL direta", { url: next });
          }
          playDirect();
        } else {
          const msg = isLive ? "Não foi possível reproduzir este canal." : "Não foi possível reproduzir esta mídia.";
          console.error("[STREAM DEBUG] ETAPA 10 — setError disparado", {
            arquivo: "src/components/VideoPlayer.tsx",
            linha: 429,
            funcao: "tryNextVod()",
            motivo: "Todos os candidatos da lista playbackCandidates foram tentados e falharam (esgotamento de fallbacks VOD/Live).",
            mensagem: msg,
            vodIdx,
            totalCandidatos: playbackCandidates.length,
          });
          void reportPlaybackFailure("Todos os candidatos falharam");
          setError(msg);
        }
      });
    };


    const armVodWatchdog = () => {
      if (!isVod) return;
      clearWatchdog();
      watchdog = setTimeout(() => {
        if (cancelled) return;
        // Só dispara fallback se nem metadata chegou. HAVE_METADATA já indica
        // que o servidor respondeu — esperar mais 6s evita falso negativo em
        // VOD de painel lento que demorou pra começar a entregar bytes.
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) tryNextVod();
        else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          watchdog = setTimeout(() => { if (!cancelled) tryNextVod(); }, 6_000);
        }
      }, 18_000);
    };

    const bufferedAhead = () => {
      try {
        const t = video.currentTime;
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= t && video.buffered.end(i) >= t) {
            return video.buffered.end(i) - t;
          }
        }
      } catch {
        // ignore browser buffer read races
      }
      return 0;
    };

    const playMpegTs = async (url: string) => {
      if (!isLive) return false;
      try {
        const mpegts = await loadMpegts();
        if (cancelled || !mpegts.isSupported()) return false;
        destroyTsPlayer();
        video.pause();
        video.removeAttribute("src");
        video.load();
        lastPlayerStrategy = "mpegts.js";
        tsPlayer = mpegts.createPlayer(
          { type: "mpegts", isLive: true, url },
          {
            isLive: true,
            enableWorker: true,
            enableStashBuffer: false,
            liveBufferLatencyChasing: true,
            liveBufferLatencyMaxLatency: 6,
            liveBufferLatencyMinRemain: 1,
          },
        );
        tsPlayer.on(mpegts.Events.ERROR, () => {
          if (!cancelled) tryNextVod();
        });
        tsPlayer.attachMediaElement(video);
        tsPlayer.load();
        const playPromise = tsPlayer.play();
        if (playPromise && typeof playPromise.then === "function") {
          playPromise.then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
        } else {
          void video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
        }
        return true;
      } catch {
        return false;
      }
    };

    const playDirect = () => {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      destroyTsPlayer();
      triedDirect = true;
      const url = playbackCandidates[vodIdx] ?? (nativeDirect ? workingSrc : proxiedX(workingSrc, kind));
      const decodedUrl = (() => {
        try {
          return decodeURIComponent(url);
        } catch {
          return url;
        }
      })();
      if (import.meta.env.DEV) {
        console.debug("[player] playDirect", {
          vodIdx,
          total: playbackCandidates.length,
          url,
          format: detectFormat(decodedUrl),
          isLive,
          isVod,
        });
      }

      if (/\.m3u8(\?|&|$)/i.test(decodedUrl)) {
        attachHls(url);
        return;
      }
      if (/\.ts(\?|&|$)/i.test(decodedUrl)) {
        // [BUFFER OPTIMIZATION] Para hosts marcados (503 bypass) ou cuja
        // estratégia preferida memorizada é HTML5, tenta <video> primeiro —
        // mpegts.js fica como fallback. mpegts.js demulta em JS e tende a
        // engasgar mais nesses painéis; o HTML5 com .ts direto, quando o
        // dispositivo aceita, roda mais fluido.
        const h = hostOf(workingSrc) ?? "";
        const preferHtml5 =
          hostStrategy.get(h) === "html5" ||
          (bypass503Hosts.has(h) && hostStrategy.get(h) !== "mpegts");
        const tStart = performance.now();
        if (preferHtml5) {
          console.log("[BUFFER OPTIMIZATION] estratégia HTML5 prioritária (.ts)", {
            host: h,
            url,
            memorizada: hostStrategy.get(h) ?? "(nenhuma)",
          });
          lastPlayerStrategy = "HTML5 <video> (.ts direto)";
          video.pause();
          video.currentTime = 0;
          video.src = url;
          video.load();
          armVodWatchdog();
          video.play().then(() => {
            setCanManualPlay(false);
            console.log("[BUFFER OPTIMIZATION] HTML5 .ts iniciou", { host: h, ms: Math.round(performance.now() - tStart) });
          }).catch(() => setCanManualPlay(true));
        } else {
          void playMpegTs(url).then((handled) => {
            if (!handled && !cancelled) {
              lastPlayerStrategy = "HTML5 <video> (.ts direto)";
              video.pause();
              video.currentTime = 0;
              video.src = url;
              video.load();
              video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
            }
          });
        }
        return;
      }
      lastPlayerStrategy = "HTML5 <video>";
      video.pause();
      video.currentTime = 0;
      video.src = url;
      video.load();
      armVodWatchdog();
      video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
    };

    // [BUFFER OPTIMIZATION] Marca quando o vídeo começou a tocar de fato.
    // Depois disso, falhas transitórias não reiniciam a estratégia inteira:
    // tentamos só video.play() e deixamos o stall-watchdog do hls.js/MSE
    // recuperar. Evita o flicker de trocar de player no meio do canal.
    let hasStartedPlaying = false;
    const onVideoError = () => {
      if (cancelled || hls) return;
      if (hasStartedPlaying) {
        console.log("[BUFFER OPTIMIZATION] engasgo após início — recover sem trocar player");
        void video.play().catch(() => undefined);
        return;
      }
      tryNextVod();
    };
    const onVideoReady = () => clearWatchdog();
    const onPlaying = () => {
      clearWatchdog();
      setCanManualPlay(false);
      if (!hasStartedPlaying) {
        hasStartedPlaying = true;
        const h = hostOf(workingSrc);
        if (h) {
          // Mapeia lastPlayerStrategy → PlaybackStrategy normalizada.
          let strat: PlaybackStrategy = "html5";
          if (lastPlayerStrategy.startsWith("HLS")) strat = "hls";
          else if (lastPlayerStrategy.startsWith("mpegts")) strat = "mpegts";
          else if (lastPlayerStrategy.startsWith("HTML5")) strat = "html5";
          if (hostStrategy.get(h) !== strat) {
            hostStrategy.set(h, strat);
            console.log("[BUFFER OPTIMIZATION] estratégia memorizada", { host: h, estrategia: strat });
          }
        }
        try {
          const ahead = bufferedAhead();
          console.log("[BUFFER OPTIMIZATION] playing", {
            host: hostOf(workingSrc),
            estrategia: lastPlayerStrategy,
            bufferAhead: Number(ahead.toFixed(2)),
          });
        } catch { /* noop */ }
      }
    };
    video.addEventListener("error", onVideoError);
    video.addEventListener("loadeddata", onVideoReady);
    video.addEventListener("canplay", onVideoReady);
    video.addEventListener("playing", onPlaying);


    const attachHls = (url: string) => {
      currentHlsUrl = url;
      if (import.meta.env.DEV) console.debug("[player] attachHls", { url, isLive, kind, forcedUA });
      // Watchdog de abertura para LIVE: se o manifesto não for parseado em 15s,
      // abandona o caminho HLS e cai direto pro .ts (mpegts.js/native).
      // Painéis Xtream que não expõem variante .m3u8 retornam 404 em todos os
      // UAs e o hls.js gastaria ~30s+ em retries antes de desistir sozinho.
      let hlsStartupTimer: ReturnType<typeof setTimeout> | null = null;
      const clearHlsStartup = () => {
        if (hlsStartupTimer) { clearTimeout(hlsStartupTimer); hlsStartupTimer = null; }
      };
      if (isLive) {
        hlsStartupTimer = setTimeout(() => {
          if (cancelled) return;
          if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return;
          if (import.meta.env.DEV) console.warn("[player] HLS startup timeout — fallback para .ts direto", { url });
          detachStallListeners?.();
          try { hls?.destroy(); } catch { /* noop */ }
          hls = null;
          // Vai pro playDirect() (mpegts.js .ts via proxy / native), sem travar UI.
          playDirect();
        }, 15_000);
      }
      if (Hls.isSupported()) {

        lastPlayerStrategy = "HLS (hls.js)";
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // Config estável (revertida da versão agressiva que travava abertura).
          // Live: buffer enxuto, como o player nativo do APK trabalha.
          // VOD: caps reduzidos para não estourar RAM em TV Box (1-2GB).
          // hls.js mantém ainda assim ~30-90s de buffer à frente — suficiente.
          backBufferLength: isLive ? 10 : 30,
          maxBufferLength: isLive ? 30 : 60,
          maxMaxBufferLength: isLive ? 60 : 180,
          maxBufferSize: isLive ? 60 * 1000 * 1000 : 90 * 1000 * 1000,
          maxBufferHole: isLive ? 1.5 : 0.5,
          highBufferWatchdogPeriod: isLive ? 2 : 3,
          nudgeMaxRetry: 6,
          nudgeOffset: 0.1,
          fragLoadingMaxRetry: 8,
          manifestLoadingMaxRetry: 6,
          levelLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 500,
          fragLoadingTimeOut: 20_000,
          manifestLoadingTimeOut: 15_000,
          levelLoadingTimeOut: 15_000,
          // Fica mais perto do edge (como nativo) e re-sincroniza rápido
          // quando a latência sobe — evita travar acumulando atraso.
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          // Live: começa pelo nível mais baixo e sem teste de banda — muitos
          // servidores IPTV não respondem ao probe de bandwidth do hls.js
          // (era o que travava a abertura dos canais no APK).
          startLevel: isLive ? 0 : -1,
          testBandwidth: !isLive,
          startFragPrefetch: true,
          abrEwmaDefaultEstimate: 1_000_000,
          abrBandWidthFactor: 0.8,
          abrBandWidthUpFactor: 0.7,
          maxStarvationDelay: 4,
          maxLoadingDelay: 4,
          capLevelToPlayerSize: true,
        });
        hls.loadSource(url);
        hls.attachMedia(video);

        // Dispara play() assim que o manifest é parseado — não espera o
        // autoPlay do browser engatar, reduz delay até primeiro frame.
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          clearHlsStartup();
          if (import.meta.env.DEV) console.debug("[player] HLS manifest parseado", { url });
          video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
        });


        let netRetries = 0;
        const MAX_NET_RETRIES = 5;
        let mediaRetries = 0;
        const MAX_MEDIA_RETRIES = 3;

        // Stall watchdog para LIVE: recuperação rápida, sem destruir/recarregar o
        // player. Se acabou o buffer, religamos o loader; se ainda tem buffer,
        // só forçamos play(). Isso corta travadas sem voltar ao bug de reload.
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const clearStall = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };

        // Fallback automático de qualidade: no primeiro sinal de travada em
        // live já fixa no nível mais baixo. É melhor perder qualidade por um
        // tempo do que deixar o canal parar repetidamente.
        const stallTimestamps: number[] = [];
        let lockedLow = false;
        let unlockTimer: ReturnType<typeof setTimeout> | null = null;
        const lockLowQuality = () => {
          if (!hls || lockedLow) return;
          lockedLow = true;
          try {
            hls.nextLevel = 0;
            hls.loadLevel = 0;
            hls.autoLevelCapping = 0;
          } catch { /* noop */ }
          if (unlockTimer) clearTimeout(unlockTimer);
          unlockTimer = setTimeout(() => {
            if (!hls) return;
            try {
              hls.autoLevelCapping = -1;
              hls.nextLevel = -1;
              hls.loadLevel = -1;
            } catch { /* noop */ }
            lockedLow = false;
            stallTimestamps.length = 0;
          }, 120_000);
        };
        const registerStall = () => {
          if (!isLive) return;
          const now = Date.now();
          stallTimestamps.push(now);
          // mantém só os últimos 45s
          while (stallTimestamps.length && now - stallTimestamps[0] > 45_000) {
            stallTimestamps.shift();
          }
          lockLowQuality();
        };

        let manifestReady = false;
        hls.on(Hls.Events.MANIFEST_PARSED, () => { manifestReady = true; });

        const recoverLiveStall = () => {
          if (!isLive || cancelled || !manifestReady) return;
          clearStall();
          stallTimer = setTimeout(() => {
            if (cancelled || !hls) return;
            const ahead = bufferedAhead();
            if (ahead < 0.75) {
              try { hls.startLoad(); } catch { /* noop */ }
            }
            void video.play().catch(() => undefined);
            if (!cancelled && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) recoverLiveStall();
          }, 3_000);
        };
        const onWaiting = () => { registerStall(); recoverLiveStall(); };
        const onResumed = () => clearStall();
        video.addEventListener("waiting", onWaiting);
        video.addEventListener("playing", onResumed);

        // Page visibility: quando a aba/tela perde foco, paramos o download
        // (hls.stopLoad) para liberar memória — buffer atual mantém o playback
        // se voltar logo. Retomamos no foco. Live: só pausa loader se estiver
        // explicitamente pausado (canal em background continua "ao vivo").
        const onVisibility = () => {
          if (!hls) return;
          const hidden = document.visibilityState === "hidden";
          try {
            if (hidden) {
              if (!isLive || video.paused) hls.stopLoad();
            } else {
              hls.startLoad();
            }
          } catch { /* noop */ }
        };
        document.addEventListener("visibilitychange", onVisibility);

        detachStallListeners = () => {
          clearStall();
          clearHlsStartup();

          if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
          video.removeEventListener("waiting", onWaiting);
          video.removeEventListener("playing", onResumed);
          document.removeEventListener("visibilitychange", onVisibility);
        };

        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (cancelled) return;
          if (!data.fatal) {
            if (isLive && (
              data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR ||
              data.details === Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE ||
              data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT ||
              data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT
            )) {
              registerStall();
              recoverLiveStall();
            }
            return;
          }
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (isLive) {
                if (netRetries++ >= MAX_NET_RETRIES) {
                  if (nativeDirect && hlsCandidate && currentHlsUrl === hlsCandidate) {
                    detachStallListeners?.();
                    hls?.destroy();
                    hls = null;
                    attachHls(proxiedX(hlsCandidate, kind));
                    return;
                  }
                  detachStallListeners?.();
                  hls?.destroy();
                  hls = null;
                  if (!triedDirect) playDirect();
                  else { console.error("[STREAM DEBUG] ETAPA 10 — setError disparado", { arquivo: "src/components/VideoPlayer.tsx", linha: 774, funcao: "attachHls()/hls.on(ERROR) NETWORK_ERROR", motivo: "hls.js retornou NETWORK_ERROR fatal após esgotar netRetries e sem candidato direto restante." }); void reportPlaybackFailure("HLS NETWORK_ERROR fatal"); setError("Conexão instável com o canal. Tente novamente."); }
                  return;
                }
                const delay = Math.min(500 * 2 ** (netRetries - 1), 8000);
                setTimeout(() => {
                  if (cancelled) return;
                  hls?.startLoad();
                }, delay);
              } else {
                detachStallListeners?.();
                tryNextVod();
              }
              return;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (isLive) {
                if (mediaRetries++ >= MAX_MEDIA_RETRIES) {
                  detachStallListeners?.();
                  hls?.destroy();
                  hls = null;
                  if (!triedDirect) playDirect();
                  else { console.error("[STREAM DEBUG] ETAPA 10 — setError disparado", { arquivo: "src/components/VideoPlayer.tsx", linha: 794, funcao: "attachHls()/hls.on(ERROR) MEDIA_ERROR", motivo: "hls.js retornou MEDIA_ERROR fatal após esgotar mediaRetries (recoverMediaError não recuperou)." }); void reportPlaybackFailure("HLS MEDIA_ERROR fatal"); setError("Erro de mídia no canal. Tente novamente."); }
                  return;
                }
                hls?.recoverMediaError();
              } else {
                detachStallListeners?.();
                tryNextVod();
              }
              return;
            default:
              detachStallListeners?.();
              hls?.destroy();
              hls = null;
              if (!triedDirect) playDirect();
              else { console.error("[STREAM DEBUG] ETAPA 10 — setError disparado", { arquivo: "src/components/VideoPlayer.tsx", linha: 808, funcao: "attachHls()/hls.on(ERROR) default", motivo: "hls.js retornou erro fatal de tipo não tratado (não NETWORK/MEDIA) e já tentamos playDirect()." }); void reportPlaybackFailure("HLS fatal (outro tipo)"); setError("Não foi possível reproduzir este canal."); }
          }
        });

      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        lastPlayerStrategy = "HTML5 nativo (HLS Safari/iOS)";
        video.src = url;
        video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
      } else {
        playDirect();
      }
    };

    void isNativeApp().then((native) => {
      if (cancelled) return;
      nativeDirect = native;
      // Para HLS ao vivo: mesmo em nativo (APK = casca https), o fetch do
      // hls.js para URL http é bloqueado pelo WebView por mixed content.
      // Roteamos pelo proxy /api/stream (mesma origem https) quando preciso.
      // forceProxy: sempre proxy; forceDirect: sempre direto (mesmo na web).
      hlsProxied = hlsCandidate
        ? forceProxy
          ? proxiedX(hlsCandidate, kind)
          : forceDirect
            ? hlsCandidate
            : proxiedX(hlsCandidate, kind)
        : null;
      if (native && forceDirect) {
        // APK/TV com transporte direto forçado: tenta direto primeiro e mantém
        // proxy como último recurso. No modo automático usamos proxy primeiro
        // para evitar bloqueio de CORS/mixed-content no WebView do APK.
        playbackCandidates.splice(0, playbackCandidates.length, ...directCandidates.flatMap((url) => {
          const secure = httpsVariant(url);
          const list = [url, secure, proxiedX(url, kind)];
          return Array.from(new Set(list.filter(Boolean) as string[]));
        }));
      } else if (native && forceProxy) {
        playbackCandidates.splice(0, playbackCandidates.length, ...directCandidates.map((u) => proxiedX(u, kind)));
      }
      if (hlsProxied) attachHls(hlsProxied);
      else playDirect();
    });

    return () => {
      cancelled = true;
      clearWatchdog();
      detachStallListeners?.();
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("loadeddata", onVideoReady);
      video.removeEventListener("canplay", onVideoReady);
      video.removeEventListener("playing", onPlaying);
      if (hls) hls.destroy();
      destroyTsPlayer();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, kind, playerMode]);

  // No APK Android, força paisagem ao entrar em tela cheia. Ao sair, NÃO
  // desbloqueia — o APK inteiro precisa permanecer em landscape (manifest +
  // ScreenOrientation.lock no boot). Desbloquear aqui fazia o app voltar
  // para portrait quando o usuário fechava o player no celular.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onFsChange = () => {
      const isFs = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
      // Sempre re-aplica landscape, tanto entrando quanto saindo do fullscreen.
      void lockLandscape();
      void isFs; // mantemos o cálculo para clareza/log futuros
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    video.addEventListener("webkitbeginfullscreen", lockLandscape as EventListener);
    video.addEventListener("webkitendfullscreen", lockLandscape as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      video.removeEventListener("webkitbeginfullscreen", lockLandscape as EventListener);
      video.removeEventListener("webkitendfullscreen", lockLandscape as EventListener);
      // Cleanup: re-aplica landscape em vez de desbloquear.
      void lockLandscape();
    };
  }, []);

  // Continue assistindo: ao carregar metadata, faz seek para a posição salva
  // (apenas VOD/série, nunca live). Reporta progresso a cada 5s, ao pausar e
  // ao desmontar para o store de histórico.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || kind === "live") return;

    let hasSeeked = false;
    // Mantemos o último (pos,dur) conhecido para conseguir salvar progresso
    // no cleanup, mesmo que outro effect já tenha resetado o <video> antes.
    let lastPos = 0;
    let lastDur = 0;

    const seekToInitial = () => {
      if (hasSeeked) return;
      const pos = initialPositionRef.current;
      const dur = video.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      if (!pos) { hasSeeked = true; return; }
      if (pos / dur > 0.95) { hasSeeked = true; return; }
      if (pos < 10) { hasSeeked = true; return; }
      try {
        video.currentTime = Math.min(pos, dur - 5);
      } catch {
        /* ignore */
      }
      hasSeeked = true;
    };

    const captureProgress = () => {
      const pos = video.currentTime;
      const dur = video.duration;
      if (Number.isFinite(pos) && pos > 0) lastPos = pos;
      if (Number.isFinite(dur) && dur > 0) lastDur = dur;
    };

    const reportProgress = () => {
      captureProgress();
      if (lastDur <= 0) return;
      onProgressRef.current?.(lastPos, lastDur);
    };

    let tickId: ReturnType<typeof setInterval> | null = null;
    const startTicking = () => {
      if (tickId) return;
      tickId = setInterval(reportProgress, 5000);
    };
    const stopTicking = () => {
      if (tickId) clearInterval(tickId);
      tickId = null;
    };

    const onLoadedMeta = () => seekToInitial();
    const onCanPlay = () => seekToInitial();
    const onPlay = () => startTicking();
    const onTimeUpdate = () => captureProgress();
    const onPause = () => {
      stopTicking();
      reportProgress();
    };
    const onEnded = () => {
      stopTicking();
      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0) onProgressRef.current?.(dur, dur);
    };

    video.addEventListener("loadedmetadata", onLoadedMeta);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("play", onPlay);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);

    return () => {
      stopTicking();
      // Salva usando os últimos valores capturados — resiliente caso o effect
      // de playback já tenha chamado video.load() antes deste cleanup.
      if (lastDur > 0) onProgressRef.current?.(lastPos, lastDur);
      video.removeEventListener("loadedmetadata", onLoadedMeta);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [src, kind]);




  // Auto-hide controles nativos após inatividade do mouse/toque
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealNativeControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    const v = videoRef.current;
    const playing = !!v && !v.paused && !v.ended;
    if (playing) {
      controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  }, []);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => revealNativeControls();
    const onPause = () => { setControlsVisible(true); if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [revealNativeControls]);

  return (
    <div
      className="relative h-full w-full bg-player"
      onMouseMove={revealNativeControls}
      onMouseEnter={revealNativeControls}
      onTouchStart={revealNativeControls}
    >
      <video
        ref={videoRef}
        poster={poster}
        {...(controls && controlsVisible ? { controls: true } : {})}
        autoPlay
        playsInline
        style={{
          ['--cue-scale' as never]: settings.subtitleScale,
          // Realce visual estilo "HDR" (apenas CSS — não é HDR real).
          // Suave pra não estourar pele/branco. Se incomodar, é só reverter.
          filter: 'saturate(1.15) contrast(1.08) brightness(1.02)',
          cursor: controlsVisible ? 'auto' : 'none',
        }}
        className={videoClass}
        hidden={playerMode === "native"}
      />
      {playerMode === "native" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-player text-foreground">
          <p className="text-sm opacity-80">Reproduzindo no player nativo (ExoPlayer)</p>
          <button
            type="button"
            onClick={() => { void openNative(); }}
            className="rounded-full bg-primary px-5 py-2 text-sm text-primary-foreground shadow-glow"
          >
            ▶ Abrir player
          </button>
        </div>
      )}
      {error && (
        <div className="absolute inset-x-0 bottom-0 bg-player/80 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {error && debugInfo && (
        <div
          className="absolute left-2 right-2 top-2 max-h-[80%] overflow-auto rounded-md border border-white/20 bg-black/85 p-3 text-[11px] leading-snug text-white shadow-xl"
          style={{ fontFamily: "monospace" }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-bold text-yellow-300">[STREAM DEBUG]</span>
            <button
              type="button"
              onClick={() => setDebugInfo(null)}
              className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/80 hover:bg-white/20"
              aria-label="Fechar diagnóstico"
            >
              fechar ✕
            </button>
          </div>
          <div className="space-y-1.5">
            <div><span className="text-white/60">ETAPA 1 — Canal:</span> {debugInfo.canal}</div>
            <div><span className="text-white/60">stream_id:</span> {debugInfo.streamId}</div>
            <div><span className="text-white/60">ETAPA 2 — URL original:</span><br/><span className="break-all">{debugInfo.urlOriginal}</span></div>
            <div><span className="text-white/60">ETAPA 3 — URL final:</span><br/><span className="break-all">{debugInfo.urlFinal}</span></div>
            <div><span className="text-white/60">ETAPA 4 — Formato detectado:</span> {debugInfo.formato}</div>
            <div><span className="text-white/60">ETAPA 5 — HTTP Status:</span> {debugInfo.httpStatus}</div>
            <div><span className="text-white/60">ETAPA 6 — Content-Type:</span> {debugInfo.contentType}</div>
            <div><span className="text-white/60">ETAPA 7 — Redirect detectado:</span> {debugInfo.redirect}</div>
            <div><span className="text-white/60">ETAPA 8 — Player utilizado:</span> {debugInfo.player}</div>
            <div><span className="text-white/60">ETAPA 9 — User-Agent:</span><br/><span className="break-all">{debugInfo.userAgent}</span></div>
            <div><span className="text-white/60">ETAPA 10 — Motivo:</span> {debugInfo.motivo}</div>
          </div>
        </div>
      )}
      {canManualPlay && !error && playerMode === "web" && (
        <button
          type="button"
          onClick={() => videoRef.current?.play().then(() => setCanManualPlay(false)).catch(() => undefined)}
          className="absolute inset-0 m-auto h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-glow flex items-center justify-center text-2xl"
          aria-label="Reproduzir"
        >
          ▶
        </button>
      )}
    </div>
  );
}
