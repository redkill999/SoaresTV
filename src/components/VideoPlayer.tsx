import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { isNativeApp } from "@/lib/xtream";
import { getPlatformConfig } from "@/lib/platform";
import { playNative, stopNative } from "@/lib/native-player";
import { store, getCompatForUrl, USER_AGENT_STRINGS, type AppSettings, type ListCompat } from "@/lib/storage";

// Module-level cache do mpegts.js: a 1ª troca de canal paga o import, as
// seguintes reusam a mesma referência (sem reparse de bundle nem nova Promise).
let mpegtsModule: typeof import("mpegts.js").default | null = null;
let mpegtsLoading: Promise<typeof import("mpegts.js").default> | null = null;

// Gerenciador central de perfil por host (persistido). Substitui a coleção
// de Sets módulo-locais por uma única fonte da verdade — ver host-profile.ts.
import {
  getHostProfile,
  updateHostProfile,
  rememberProxyDead,
  rememberHttpsFailure,
  rememberPreferredPlayer,
  isProxyDeadStatus,
  hostOf,
  type PlaybackStrategy,
} from "@/lib/host-profile";
import { decideEngineOrder, plog } from "@/lib/playback-engine";
import { probeLiveStream, logLiveProbeReport, liveContentKind } from "@/lib/live-debug";
import {
  liveDiagStart, liveDiagAttachProbe, liveDiagRecordAttempt,
  liveDiagMarkPlaying, liveDiagMarkFailed, liveDiagLatestFailedFor,
  liveDiagSetMediaInfo, liveDiagRecordFreeze,
  type LivePlayerKind,
} from "@/lib/live-diag-store";
import { LiveDiagPanel } from "@/components/LiveDiagPanel";
import {
  vodDiagStart, vodDiagRecordAttempt, vodDiagPatchAttempt,
  vodDiagMarkPlaying, vodDiagMarkFailed, vodDiagLatestFailedFor,
  vodDiagAttachFinalProbe, probeVodCandidateForDiag,
  type VodPlayerKind,
} from "@/lib/vod-diag-store";
import { VodDiagPanel } from "@/components/VodDiagPanel";
import { DEBUG } from "@/lib/debug";
import { auditEvent } from "@/lib/audit-trace";
export type { PlaybackStrategy } from "@/lib/host-profile";



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
    if (getHostProfile(host).forceHttp) {
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

function httpsVariantIgnoringHostProfile(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return /^https:$/i.test(parsed.protocol) ? parsed.toString() : null;
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

const EMPTY_VOD_FALLBACKS: string[] = [];

export function VideoPlayer({
  src,
  poster,
  kind,
  fallbackSrcs = EMPTY_VOD_FALLBACKS,
  initialPosition,
  onProgress,
  controls = true,
}: {
  src: string;
  poster?: string;
  kind?: "live" | "vod";
  fallbackSrcs?: string[];
  initialPosition?: number;
  onProgress?: (positionSec: number, durationSec: number) => void;
  controls?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // [LIVE DIAG] painel visível dentro do APK quando LIVE falha.
  const [diagOpen, setDiagOpen] = useState(false);
  const diagSessionIdRef = useRef<string | null>(null);
  // [VOD DIAG] painel temporário para filmes/séries no preview web/APK.
  const [vodDiagOpen, setVodDiagOpen] = useState(false);
  const vodDiagSessionIdRef = useRef<string | null>(null);
  const vodDiagFinalizingRef = useRef(false);

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
  // FIX D2 (audit IPTV): rastreia quando o player nativo abriu para distinguir
  // back-button legítimo (usuário assistiu N segundos) de falha precoce
  // (plugin abriu mas ExoPlayer fechou em <8s sem progresso) — neste último
  // caso, cai para o pipeline web (hls.js/mpegts) automaticamente.
  const nativeStartedAtRef = useRef(0);
  const openNative = useCallback(async () => {
    const native = await isNativeApp();
    if (!native) return false;
    const compat = getCompatForUrl(src);
    const ua =
      compat.userAgent && compat.userAgent !== "auto"
        ? USER_AGENT_STRINGS[compat.userAgent]
        : "XCIPTV/7.0 (Linux; Android 13)";
    const ok = await playNative({
      url: src,
      userAgent: ua,
      startAtSec: kind !== "live" ? initialPositionRef.current : undefined,
      onExit: (pos) => {
        const elapsed = Date.now() - (nativeStartedAtRef.current || Date.now());
        // FIX D2: ExoPlayer fechou em <8s sem ter avançado: provavelmente
        // erro de abertura/codec/DNS mid-handshake. Força fallback web.
        if (elapsed < 8_000 && pos <= 0) {
          console.warn("[NATIVE FALLBACK] ExoPlayer encerrou em <8s sem progresso — caindo para pipeline web", {
            kind, elapsedMs: elapsed,
          });
          nativeOpenedRef.current = false;
          setPlayerMode("web");
          return;
        }
        if (kind !== "live" && pos > 0) {
          // Duração real não vem do plugin; salvamos posição com duração
          // best-effort para o store de "Continuar assistindo".
          onProgressRef.current?.(pos, Math.max(pos + 1, pos));
        }
      },
    });
    if (ok) nativeStartedAtRef.current = Date.now();
    return ok;
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
    vodDiagFinalizingRef.current = false;
    
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
    // No web desktop, manter HLS-first/proxy-first para `.ts` ao vivo:
    // o navegador não decodifica MPEG-TS cru de forma confiável, e o preview
    // precisa do proxy para evitar CORS/mixed-content. O preset `.ts` direto
    // continua sendo padrão apenas no APK, onde ExoPlayer/WebView lida melhor.
    const liveHost = hostOf(workingSrc);
    const liveProfile = liveHost ? getHostProfile(liveHost) : {};
    const isLiveUrl = /\/live\/[^/]+\/[^/]+\//i.test(workingSrc);
    const platformCfg = getPlatformConfig();
    const isWebPlayback = platformCfg.platform === "web";
    const liveDisableHls = isLiveUrl && !isWebPlayback && liveProfile.disableHlsConversion !== false && liveProfile.preferTs !== false;
    const liveBypassProxy = isLiveUrl && !isWebPlayback && liveProfile.bypassProxyForLive !== false;
    const livePreferTs = isLiveUrl && !isWebPlayback && liveProfile.preferTs !== false;

    const skipHls =
      compat.streamFormat === "ts" ||
      compat.streamFormat === "mp4" ||
      liveDisableHls ||
      (compat.streamFormat == null && (auto === "mp4" || auto === "mkv"));

    const hlsCandidate = skipHls ? null : toHlsCandidate(workingSrc, kind);
    let hlsProxied: string | null = null;

    // Fallbacks de VOD: alguns provedores Xtream entregam o mesmo filme
    // em containers diferentes. Se o original falhar, tentamos .mp4 e .mkv.
    const isVod = kind === "vod" || /\/movie\/[^/]+\/[^/]+\//i.test(workingSrc) || /\/series\/[^/]+\/[^/]+\//i.test(workingSrc);
    const isLive = isLiveUrl;
    const vodCandidates: string[] = [];
    const vodSourceInputs = Array.from(new Set([
      workingSrc,
      ...(isVod ? fallbackSrcs : []),
    ].filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u))));
    for (const vodSource of vodSourceInputs) {
      const vodMatch = vodSource.match(/^(.*)\.([a-z0-9]+)(\?.*)?$/i);
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
      } else if (!vodCandidates.includes(vodSource)) {
        vodCandidates.push(vodSource);
      }
    }
    if (!vodCandidates.length) vodCandidates.push(workingSrc);
    const directCandidates = isLive ? liveDirectCandidates(workingSrc) : vodCandidates;
    const playbackCandidates = isVod
      ? vodCandidates.flatMap((url) => {
          const secure = isWebPlayback ? httpsVariantIgnoringHostProfile(url) : httpsVariant(url);
          // Por padrão (web): proxy primeiro (https same-origin, sem mixed content).
          // forceDirect inverte: tenta direto antes; forceProxy: só proxy.
          let candidates: (string | null)[];
          if (forceDirect) {
            candidates = [secure, url, proxiedX(url, "vod"), secure ? proxiedX(secure, "vod") : null];
          } else if (forceProxy) {
            candidates = [proxiedX(url, "vod"), secure ? proxiedX(secure, "vod") : null];
          } else {
            candidates = [
              proxiedX(url, "vod"),
              secure ? proxiedX(secure, "vod") : null,
              secure,
              // Se o proxy do preview falhar para VOD, ainda deixa o browser
              // tentar a URL original HTTPS diretamente. Isso não mexe em LIVE
              // nem no APK, e evita prender filmes/séries em um único caminho.
              /^https:\/\//i.test(url) ? url : null,
            ];
          }
          return Array.from(new Set(candidates.filter(Boolean) as string[]));
        })
      : liveBypassProxy
        // LIVE com bypass de proxy: ORIGINAL direto → https direto → proxy (fallback).
        ? Array.from(new Set(directCandidates.flatMap((url) => {
            const secure = httpsVariant(url);
            return [url, secure, proxiedX(url, kind)].filter(Boolean) as string[];
          })))
        : directCandidates.map((url) => proxiedX(url, kind));

    if (isLive) {
      console.log("[LIVE ORIGINAL URL]", src);
      console.log("[LIVE FINAL URL] ordem de tentativa:", playbackCandidates);
      console.log("[LIVE PROXY STATUS]", {
        host: liveHost,
        bypassProxyForLive: liveBypassProxy,
        disableHlsConversion: liveDisableHls,
        preferTs: livePreferTs,
      });

      // [LIVE DIAG] cria sessão no buffer (consultável em Settings → Diagnóstico).
      diagSessionIdRef.current = liveDiagStart({
        originalUrl: src,
        workingSrc,
        host: liveHost,
        forcedUA,
        liveBypassProxy,
        liveDisableHls,
        livePreferTs,
        finalCandidates: playbackCandidates.slice(),
      });
      setDiagOpen(false);

      // ===== [LIVE DEBUG] probe assíncrono via /api/stream (HEAD + UA cycle) =
      // Não bloqueia o playback. Só descobre status/content-type/UA do canal.
      // Se nenhum UA aceitar (todos 401/403/404), grava no host-profile o UA
      // que respondeu — playlist subsequente já tenta com ele direto.
      void (async () => {
        try {
          const report = await probeLiveStream(workingSrc, forcedUA);
          logLiveProbeReport(report, { originalSrc: src, finalCandidates: playbackCandidates });
          if (diagSessionIdRef.current) liveDiagAttachProbe(diagSessionIdRef.current, report);
          // Se um UA não-preferido foi o único que funcionou, memoriza para
          // reuso (apenas log; aplicação efetiva via compat fica para o user
          // por enquanto, evitando regressões silenciosas).
          if (report.best?.ok && report.best.ua !== "preferred" && !forcedUA) {
            console.log("[LIVE DEBUG] UA recomendado para este host:", {
              host: liveHost,
              ua: report.best.ua,
              uaString: report.best.uaString,
              dica: "Para fixar: Settings → User-Agent da lista, ou updateHostProfile(host, { ... }).",
            });
          }
          // Se content-type vier como HLS mas estamos pulando HLS (preset),
          // sinaliza para o usuário que talvez valha reativar HLS neste host.
          if (report.best?.ok && liveDisableHls && liveContentKind(report.best.contentType) === "hls") {
            console.warn("[LIVE DEBUG] Host responde HLS mas disableHlsConversion=true. Considere updateHostProfile(host, { disableHlsConversion: false, preferTs: false }).");
          }
        } catch (e) {
          console.warn("[LIVE DEBUG] probe falhou:", (e as Error).message);
        }
      })();
    }

    if (isVod) {
      const vodHost = hostOf(workingSrc);
      const sourceKind = /\/series\//i.test(workingSrc)
        ? "series"
        : /\/movie\//i.test(workingSrc)
          ? "movie"
          : "vod";
      console.log("[VOD DEBUG] sessão iniciada", {
        sourceKind,
        originalUrl: src,
        workingSrc,
        host: vodHost,
        forcedUA: forcedUA ?? "(auto)",
        candidates: playbackCandidates,
      });
      vodDiagSessionIdRef.current = vodDiagStart({
        sourceKind,
        originalUrl: src,
        workingSrc,
        host: vodHost,
        forcedUA,
        finalCandidates: playbackCandidates.slice(),
      });
      setVodDiagOpen(false);
    }

    // ===== [503 BYPASS] — host já marcado nesta sessão =====================
    // Se já vimos esse host responder 503 antes, prioriza diretos.
    const srcHost = hostOf(workingSrc);
    if (srcHost && getHostProfile(srcHost).disableProxy && !forceProxy && !isVod) {
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

    // [PLAYBACK ENGINE] Decisão determinística da ordem de engines.
    // Apenas log/telemetria — a execução continua via candidate URLs.
    try {
      const envForLog: "native-apk" | "web" = shouldUseNativePlayer ? "native-apk" : "web";
      const order = decideEngineOrder(hostOf(workingSrc), kind, envForLog);
      plog("start", { host: hostOf(workingSrc), kind, env: envForLog, src });
      plog("engine-pick", {
        host: hostOf(workingSrc),
        ordem: order,
        memorizada: hostOf(workingSrc) ? getHostProfile(hostOf(workingSrc)!).preferPlayer ?? null : null,
        candidatos: playbackCandidates.length,
      });
    } catch { /* noop */ }

    auditEvent(diagSessionIdRef.current, "channel-open", {
      src, kind, host: hostOf(workingSrc), isLive, isVod, candidates: playbackCandidates.length,
    });
    auditEvent(diagSessionIdRef.current, "engine-pick", {
      ordem: decideEngineOrder(hostOf(workingSrc), kind, shouldUseNativePlayer ? "native-apk" : "web"),
    });


    const effectStartT = performance.now();
    let hls: Hls | null = null;
    let tsPlayer: MpegTsPlayer | null = null;
    let cancelled = false;
    let vodIdx = 0;
    let triedDirect = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let nativeDirect = false;
    let currentHlsUrl: string | null = null;
    let currentPlaybackUrl: string | null = null;
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
        let contentLength = "";
        let contentRange = "";
        let acceptRanges = "";
        if (isProxy) {
          const ac = new AbortController();
          const probeTimer = setTimeout(() => ac.abort(), 6_000);
          try {
            const res = await fetch(currentUrl, { method: "HEAD", cache: "no-store", signal: ac.signal });
            probeStatus = res.status;
            upstreamStatus = res.headers.get("X-Upstream-Status") ?? "";
            upstreamCt = res.headers.get("X-Upstream-Content-Type") ?? "";
            upstreamFinal = res.headers.get("X-Upstream-Final-Url") ?? "";
            upstreamUA = res.headers.get("X-Upstream-User-Agent") ?? "";
            upstreamOriginHdrs = res.headers.get("X-Upstream-Origin-Headers") ?? "";
            upstreamRedirected = res.headers.get("X-Upstream-Redirected") ?? "";
            contentLength = res.headers.get("content-length") ?? "";
            contentRange = res.headers.get("content-range") ?? "";
            acceptRanges = res.headers.get("accept-ranges") ?? "";
          } catch (e) {
            probeStatus = `probe-fail: ${(e as Error).message}`;
          } finally {
            clearTimeout(probeTimer);
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
          contentLength,
          contentRange,
          acceptRanges,
          urlFinalUpstream: upstreamFinal,
          uaUsadoUpstream: upstreamUA,
          headersOrigemReferer: upstreamOriginHdrs === "1",
          redirecionado: upstreamRedirected === "1",
          playerEstrategia: lastPlayerStrategy,
        });
        if (isVod && vodDiagSessionIdRef.current) {
          vodDiagAttachFinalProbe(vodDiagSessionIdRef.current, {
            clientStatus: probeStatus,
            upstreamStatus,
            contentType: upstreamCt,
            contentLength,
            contentRange,
            acceptRanges,
            finalUrl: upstreamFinal,
            userAgent: upstreamUA,
            originHeaders: upstreamOriginHdrs === "1",
            redirected: upstreamRedirected === "1",
          });
        }
        // Painel visual removido — diagnóstico fica nos logs acima.

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
              rememberHttpsFailure(t.host.toLowerCase());
            }
          } catch { /* noop */ }
        }
        if (!failedUrl || !failedUrl.startsWith("/api/stream")) return false;
        // FIX D10 (audit IPTV): HEAD probe não tinha timeout — se host estiver
        // offline, o probe podia segurar ~30s (timeout default do browser)
        // dobrando o tempo de recuperação por candidato. Agora 4s máx.
        const ac = new AbortController();
        const probeTimer = setTimeout(() => ac.abort(), 4_000);
        let res: Response;
        try {
          res = await fetch(failedUrl, { method: "HEAD", signal: ac.signal });
        } finally {
          clearTimeout(probeTimer);
        }
        const upstream = res.headers.get("X-Upstream-Status") ?? "";

        // 502/503/504 → proxy não conseguiu falar com upstream. Marca o host
        // como "proxy morto" e injeta candidatos diretos no fluxo.
        const proxyDead = isProxyDeadStatus(res.status) || isProxyDeadStatus(upstream);
        if (!proxyDead) return false;
        const host = hostOf(workingSrc);
        if (host) rememberProxyDead(host, upstream || String(res.status));

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

    const recordFailedAttempt = (errMsg?: string) => {
      let kind: LivePlayerKind = "unknown";
      if (lastPlayerStrategy.startsWith("HLS")) kind = "hls";
      else if (lastPlayerStrategy.startsWith("mpegts")) kind = "mpegts";
      else if (lastPlayerStrategy.startsWith("HTML5")) kind = "html5";
      const url = playbackCandidates[Math.min(vodIdx, playbackCandidates.length - 1)] ?? workingSrc;
      const ve = videoRef.current?.error ?? null;
      const baseError = errMsg ?? ve?.message ?? lastPlayerStrategy;
      if (isLive && diagSessionIdRef.current) {
        liveDiagRecordAttempt(diagSessionIdRef.current, {
          player: kind,
          url,
          result: "fail",
          error: baseError,
          videoErrorCode: ve?.code ?? null,
          at: Date.now(),
        });
      }
      if (isVod && vodDiagSessionIdRef.current) {
        const sessionId = vodDiagSessionIdRef.current;
        const attemptId = vodDiagRecordAttempt(vodDiagSessionIdRef.current, {
          player: kind as VodPlayerKind,
          url,
          result: "fail",
          error: baseError,
          videoErrorCode: ve?.code ?? null,
          readyState: video.readyState,
          networkState: video.networkState,
          currentTime: video.currentTime,
          duration: Number.isFinite(video.duration) ? video.duration : undefined,
          at: Date.now(),
        });
        void probeVodCandidateForDiag(url).then((probe) => {
          vodDiagPatchAttempt(sessionId, attemptId, probe);
        });
        console.warn("[VOD DEBUG] tentativa falhou", {
          player: kind,
          url,
          error: baseError,
          videoErrorCode: ve?.code ?? null,
          readyState: video.readyState,
          networkState: video.networkState,
        });
      }
    };

    const tryNextVod = (reason?: string) => {
      clearWatchdog();
      recordFailedAttempt(reason);
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
          auditEvent(diagSessionIdRef.current, "fallback-next-candidate", {
            idx: vodIdx, total: playbackCandidates.length, url: next,
          });
          if (next && !next.startsWith("/api/stream")) {
            console.log("[503 BYPASS] próxima tentativa via URL direta", { url: next });
          }
          playDirect();
        } else {
          // FIX D11 (audit IPTV): mensagem específica baseada no último motivo
          // de falha detectado, em vez de uma única genérica para todos os modos.
          const ve = videoRef.current?.error ?? null;
          const code = ve?.code ?? null;
          let msg: string;
          if (isLive) {
            if (code === 4) msg = "Formato deste canal não é compatível com o navegador. Tente no app Android.";
            else if (code === 3) msg = "Erro de decodificação. Pode ser codec não suportado (ex.: HEVC/EAC3).";
            else if (code === 2) msg = "Falha de rede ao conectar ao canal. Verifique sua conexão.";
            else msg = `Não foi possível reproduzir este canal após ${playbackCandidates.length} tentativas.`;
          } else {
            if (code === 4) msg = "Formato deste vídeo não é compatível com seu navegador.";
            else if (code === 3) msg = "Erro de decodificação do vídeo.";
            else if (code === 2) msg = "Falha de rede ao carregar este vídeo.";
            else msg = "Não foi possível reproduzir esta mídia.";
          }
          console.error("[STREAM DEBUG] ETAPA 10 — setError disparado", {
            arquivo: "src/components/VideoPlayer.tsx",
            linha: 429,
            funcao: "tryNextVod()",
            motivo: "Todos os candidatos da lista playbackCandidates foram tentados e falharam (esgotamento de fallbacks VOD/Live).",
            mensagem: msg,
            videoErrorCode: code,
            vodIdx,
            totalCandidatos: playbackCandidates.length,
          });
          plog("final-fail", {
            host: hostOf(workingSrc),
            tentativas: playbackCandidates.length,
            ultimaEstrategia: lastPlayerStrategy,
            videoErrorCode: code,
          });
          auditEvent(diagSessionIdRef.current, "final-fail", {
            host: hostOf(workingSrc),
            attempts: playbackCandidates.length,
            lastStrategy: lastPlayerStrategy,
            videoErrorCode: code,
          });
          // Para VOD aguardamos o HEAD rápido do proxy antes de abrir o painel,
          // senão o usuário via "Sem probe" enquanto o fetch ainda estava em
          // andamento. LIVE mantém comportamento anterior para não mexer nos canais.
          if (isVod) {
            vodDiagFinalizingRef.current = true;
            void reportPlaybackFailure(msg).finally(() => {
              vodDiagFinalizingRef.current = false;
              if (cancelled) return;
              if (vodDiagSessionIdRef.current) vodDiagMarkFailed(vodDiagSessionIdRef.current, msg);
              setVodDiagOpen(true);
            });
          } else {
            void reportPlaybackFailure(msg);
          }
          if (isLive && diagSessionIdRef.current) {
            liveDiagMarkFailed(diagSessionIdRef.current, msg);
            setDiagOpen(true);
          }
          setError(msg);
        }

      });
    };


    const armVodWatchdog = () => {
      clearWatchdog();
      if (isVod) {
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
        return;
      }
      // FIX D1 (audit IPTV): LIVE .ts direto não tinha NENHUM watchdog —
      // host que aceita TCP sem enviar dados pendurava o player indefinidamente.
      // Agora: 22s sem first-frame (currentTime ainda 0 e sem dados) → próximo
      // candidato. Cancelado naturalmente por clearWatchdog() em onPlaying/
      // onCanPlay/onLoadedData ou em tryNextVod.
      watchdog = setTimeout(() => {
        if (cancelled) return;
        if (video.currentTime <= 0 && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          console.warn("[LIVE DEBUG] startup watchdog LIVE 22s — sem first-frame, próximo candidato");
          tryNextVod();
        }
      }, 22_000);
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

    const safeDecodeUrl = (url: string) => {
      try { return decodeURIComponent(url); } catch { return url; }
    };

    // [LIVE STABILITY] estatísticas mais recentes do mpegts.js (usado nos
    // logs de freeze e no relatório de diagnóstico).
    const mpegtsStats = { decodedFrames: 0, droppedFrames: 0, speedKbps: 0 };

    const playMpegTs = async (url: string) => {
      if (!isLive && !isVod) return false;
      try {
        const mpegts = await loadMpegts();
        if (cancelled || !mpegts.isSupported()) return false;
        destroyTsPlayer();
        video.pause();
        video.removeAttribute("src");
        video.load();
        // Config de plataforma (APK vs Web) — fonte única em src/lib/platform.ts.
        // Qualquer ajuste futuro de APK não pode vazar pro browser e vice-versa.
        const platformCfg = getPlatformConfig();
        const absoluteUrl =
          platformCfg.absolutizeProxyUrl &&
          !/^https?:\/\//i.test(url) &&
          typeof window !== "undefined"
            ? new URL(url, window.location.origin).toString()
            : url;
        currentPlaybackUrl = absoluteUrl;
        lastPlayerStrategy = "mpegts.js";
        // [LIVE STABILITY] Config relaxada para H.265/HEVC FHD:
        //  - liveBufferLatencyChasing OFF: deixava o player descartar buffer
        //    agressivamente para perseguir o edge, causando starvation em
        //    streams pesados (HEVC FHD).
        //  - liveBufferLatencyMaxLatency 45s + MinRemain 20s: tolera variação
        //    de chegada de pacotes sem cortar.
        //  - enableStashBuffer ON + autoCleanup agressivo desligado:
        //    mantém pelo menos ~20s à frente; SourceBuffer só limpa o passado.
        tsPlayer = mpegts.createPlayer(
          { type: "mpegts", isLive, url: absoluteUrl },
          {
            isLive,
            // enableWorker vem do preset por plataforma:
            //   web  → false (Blob worker = origin null = "Failed to fetch")
            //   apk  → true  (WebView Android aceita)
            enableWorker: platformCfg.mpegts.enableWorker,
            enableStashBuffer: true,
            stashInitialSize: isLive ? 1024 : 384, // LIVE folgado; VOD menor para abrir rápido
            liveBufferLatencyChasing: false,
            liveBufferLatencyMaxLatency: 45,
            liveBufferLatencyMinRemain: 20,
            autoCleanupSourceBuffer: false,
            lazyLoad: false,
            seekType: "range",
          },
        );
        tsPlayer.on(mpegts.Events.ERROR, (...args: unknown[]) => {
          // mpegts.js emite ERROR como (type, details, info?). Capturamos
          // tudo para que o diagnóstico LIVE mostre o motivo real (Network
          // EarlyEof, CodeError, MediaError MSE_ADD_SOURCEBUFFER, etc.) em
          // vez do genérico "mpegts.js".
          const [errType, errDetails, errInfo] = args as [unknown, unknown, unknown];
          const detailMsg =
            (errInfo && typeof errInfo === "object" && "msg" in (errInfo as Record<string, unknown>)
              ? String((errInfo as { msg?: unknown }).msg ?? "")
              : "") ||
            (typeof errDetails === "string" ? errDetails : "") ||
            "";
          const composed = [errType, errDetails, detailMsg].filter(Boolean).join(" | ");
          console.warn("[TS DEBUG] mpegts.js ERROR", { url, type: errType, details: errDetails, info: errInfo, isLive, isVod });
          if (!cancelled) tryNextVod(`mpegts.js: ${composed || "unknown"}`);
        });
        // FIX D5 (audit IPTV): provedor que fecha a conexão TS graciosamente
        // (sem RST) dispara LOADING_COMPLETE — antes não havia handler e o
        // vídeo congelava sem trocar de candidato. Agora escala para o próximo
        // candidato se o canal ainda não estabilizou (sem frames decodificados
        // recentes) ou se o stream encerrou antes do primeiro frame.
        tsPlayer.on(mpegts.Events.LOADING_COMPLETE, () => {
          if (cancelled) return;
          const decoded = mpegtsStats.decodedFrames || 0;
          console.warn("[TS DEBUG] mpegts.js LOADING_COMPLETE", {
            url, decodedFrames: decoded, currentTime: video.currentTime, isLive, isVod,
          });
          if (!isLive) {
            if (video.currentTime < 1) tryNextVod("mpegts.js loading_complete antes do primeiro frame");
            return;
          }
          // Se nunca avançou para o primeiro frame ou parou logo após início,
          // tratamos como canal terminado/offline e tentamos o próximo.
          if (decoded < 30 || video.currentTime < 1) {
            tryNextVod();
          }
        });

        // Captura codec/resolução real do stream.
        tsPlayer.on(mpegts.Events.MEDIA_INFO, (info: unknown) => {
          const m = info as {
            videoCodec?: string; audioCodec?: string;
            width?: number; height?: number; fps?: number;
          };
          const payload = {
            videoCodec: m.videoCodec, audioCodec: m.audioCodec,
            width: m.width, height: m.height, fps: m.fps,
          };
          console.log("[LIVE STABILITY] MEDIA_INFO", payload);
          if (diagSessionIdRef.current) liveDiagSetMediaInfo(diagSessionIdRef.current, payload);
        });
        // Estatísticas contínuas (frames/speed).
        tsPlayer.on(mpegts.Events.STATISTICS_INFO, (info: unknown) => {
          const s = info as { decodedFrames?: number; droppedFrames?: number; speed?: number };
          if (s.decodedFrames != null) mpegtsStats.decodedFrames = s.decodedFrames;
          if (s.droppedFrames != null) mpegtsStats.droppedFrames = s.droppedFrames;
          if (s.speed != null) mpegtsStats.speedKbps = Math.round(s.speed); // KB/s reportado
        });
        tsPlayer.attachMediaElement(video);
        tsPlayer.load();
        armVodWatchdog();
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
      currentPlaybackUrl = url;
      const decodedUrl = safeDecodeUrl(url);
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
        // [LIVE DEBUG] Ordem para LIVE .ts: Native HTML5 → mpegts.js → (HLS).
        // Empiricamente, <video> nativo com .ts entrega frame mais rápido em
        // dispositivos que aceitam o container; mpegts.js (demux JS) fica
        // como fallback. Para VOD/outros casos, mantém heurística por host.
        const h = hostOf(workingSrc) ?? "";
        const profile = getHostProfile(h);
        // FIX 5.1: navegador web desktop (Chrome/Edge/Firefox) NÃO decodifica
        // MPEG-TS via <video src=".ts"> — tentar HTML5 primeiro desperdiça ~3s
        // até o erro 4 (SRC_NOT_SUPPORTED) e força fallback para mpegts.js.
        // Em APK nativo (ExoPlayer) e em hosts com profile.preferPlayer="html5"
        // memorizado, mantém o comportamento atual.
        const preferHtml5 =
          !isVod && (
            profile.preferPlayer === "html5" ||
            (shouldUseNativePlayer && isLive) ||
            (profile.disableProxy && profile.preferPlayer !== "mpegts")
          );
        const tStart = performance.now();
        if (preferHtml5) {
          console.log("[LIVE DEBUG] tentativa 1/2: HTML5 nativo (.ts direto)", {
            host: h, url, memorizada: profile.preferPlayer ?? "(nenhuma)",
          });

          lastPlayerStrategy = "HTML5 <video> (.ts direto)";
          video.pause();
          video.currentTime = 0;
          video.src = url;
          video.load();
          armVodWatchdog();
          // Se HTML5 falhar em LIVE, tenta mpegts.js antes de iterar candidatos.
          let html5FellBack = false;
          const onceErr = () => {
            if (cancelled || html5FellBack) return;
            html5FellBack = true;
            video.removeEventListener("error", onceErr);
            const err = video.error;
            console.warn("[LIVE DEBUG] HTML5 falhou", {
              host: h,
              videoErrorCode: err?.code ?? null,
              videoErrorMessage: err?.message ?? null,
              ms: Math.round(performance.now() - tStart),
            });
            if (isLive) {
              console.log("[LIVE DEBUG] tentativa 2/2: mpegts.js");
              void playMpegTs(url).then((handled) => {
                if (!handled && !cancelled) {
                  console.warn("[LIVE DEBUG] mpegts.js também falhou — próximo candidato");
                  tryNextVod();
                }
              });
            }
          };
          video.addEventListener("error", onceErr, { once: true });
          video.play().then(() => {
            setCanManualPlay(false);
            console.log("[LIVE DEBUG] HTML5 .ts iniciou", { host: h, ms: Math.round(performance.now() - tStart) });
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
        // FIX D12 (audit IPTV): MediaError code=3 (MEDIA_ERR_DECODE) e code=4
        // (SRC_NOT_SUPPORTED) pós-início são fatais — apenas chamar play() não
        // recupera. Escalamos para o próximo candidato. code=1/2 (transitório)
        // continua tratado pelo recovery silencioso anterior.
        const errCode = video.error?.code;
        if (errCode === 3 || errCode === 4) {
          console.warn("[VIDEO ERROR] erro fatal pós-início (code=" + errCode + ") — próximo candidato");
          hasStartedPlaying = false;
          tryNextVod();
          return;
        }
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
        auditEvent(diagSessionIdRef.current, "engine-ok", {
          strategy: lastPlayerStrategy,
          attemptsBeforeOk: vodIdx + 1,
          elapsedMs: Math.round(performance.now() - effectStartT),
        });
        const h = hostOf(workingSrc);
        if (h) {
          // Mapeia lastPlayerStrategy → PlaybackStrategy normalizada.
          let strat: PlaybackStrategy = "html5";
          if (lastPlayerStrategy.startsWith("HLS")) strat = "hls";
          else if (lastPlayerStrategy.startsWith("mpegts")) strat = "mpegts";
          else if (lastPlayerStrategy.startsWith("HTML5")) strat = "html5";
          if (getHostProfile(h).preferPlayer !== strat) {
            rememberPreferredPlayer(h, strat);
            console.log("[BUFFER OPTIMIZATION] estratégia memorizada", { host: h, estrategia: strat });
          }
          // [LIVE DIAG] marca sucesso (LIVE só).
          if (isLive && diagSessionIdRef.current) {
            let kind: LivePlayerKind = "html5";
            if (lastPlayerStrategy.startsWith("HLS")) kind = "hls";
            else if (lastPlayerStrategy.startsWith("mpegts")) kind = "mpegts";
            const url = playbackCandidates[Math.min(vodIdx, playbackCandidates.length - 1)] ?? workingSrc;
            liveDiagMarkPlaying(diagSessionIdRef.current, kind, url);
          }
          if (isVod && vodDiagSessionIdRef.current) {
            let kind: VodPlayerKind = "html5";
            if (lastPlayerStrategy.startsWith("HLS")) kind = "hls";
            else if (lastPlayerStrategy.startsWith("mpegts")) kind = "mpegts";
            const url = playbackCandidates[Math.min(vodIdx, playbackCandidates.length - 1)] ?? workingSrc;
            vodDiagMarkPlaying(vodDiagSessionIdRef.current, kind, url);
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

    // ===== [LIVE STABILITY] Telemetria de estabilidade do <video> ===========
    // Loga waiting/stalled/suspend/canplay/canplaythrough + currentTime,
    // buffered, readyState, networkState, bytes/s (estimado pelo crescimento
    // de buffered). Só ativa para LIVE; VOD segue inalterado.
    let stabCleanup: (() => void) | null = null;
    if (isLive) {
      const fmtRanges = () => {
        try {
          const r: string[] = [];
          for (let i = 0; i < video.buffered.length; i++) {
            r.push(`[${video.buffered.start(i).toFixed(2)}-${video.buffered.end(i).toFixed(2)}]`);
          }
          return r.join(",") || "(vazio)";
        } catch { return "(erro)"; }
      };
      const snapshot = () => ({
        currentTime: video.currentTime,
        bufferedAhead: bufferedAhead(),
        bufferedRanges: fmtRanges(),
        readyState: video.readyState,
        networkState: video.networkState,
        decodedFrames: (() => {
          const q = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null;
          return mpegtsStats.decodedFrames || q?.totalVideoFrames || 0;
        })(),
        droppedFrames: (() => {
          const q = typeof video.getVideoPlaybackQuality === "function" ? video.getVideoPlaybackQuality() : null;
          return mpegtsStats.droppedFrames || q?.droppedVideoFrames || 0;
        })(),
        speedKbps: mpegtsStats.speedKbps,
      });
      const logFreeze = (trigger: "waiting" | "stalled" | "suspend" | "watchdog") => {
        const snap = snapshot();
        const payload = { trigger, ...snap, host: hostOf(workingSrc), strategy: lastPlayerStrategy };
        console.warn("[LIVE STABILITY] FREEZE", payload);
        if (diagSessionIdRef.current) {
          liveDiagRecordFreeze(diagSessionIdRef.current, { at: Date.now(), ...snap, trigger });
        }
      };
      let liveRecoveryBusy = false;
      let lastLiveRecoveryAt = 0;
      let html5LiveReconnects = 0;
      let pendingRecoverTimer: ReturnType<typeof setTimeout> | null = null;
      const clearPendingRecover = () => {
        if (pendingRecoverTimer) clearTimeout(pendingRecoverTimer);
        pendingRecoverTimer = null;
      };
      const nudgeIntoBufferedRange = () => {
        const ahead = bufferedAhead();
        if (ahead <= 2) return false;
        try {
          video.currentTime = Math.min(video.currentTime + 0.35, video.currentTime + Math.max(0.1, ahead - 0.5));
          return true;
        } catch {
          return false;
        }
      };
      // FIX D8 (audit IPTV): escalada de stalls recorrentes. Antes, o sistema
      // ficava em loop eterno de recovery sem nunca trocar de candidato. Agora:
      // 4 stalls em 60s do MESMO candidato → tryNextVod(). VOD usa watchdog
      // próprio, então isso só vale para LIVE.
      const webStallTimestamps: number[] = [];
      const recoverLiveWebStall = (reason: "waiting" | "stalled" | "suspend" | "watchdog") => {
        if (cancelled || liveRecoveryBusy) return;
        const now = Date.now();
        if (now - lastLiveRecoveryAt < 7_000) return;
        lastLiveRecoveryAt = now;
        webStallTimestamps.push(now);
        while (webStallTimestamps.length && now - webStallTimestamps[0] > 60_000) {
          webStallTimestamps.shift();
        }
        if (webStallTimestamps.length >= 4) {
          console.warn("[STALL ESCALATION] 4 stalls em 60s no mesmo candidato — escalando para próximo", {
            strategy: lastPlayerStrategy,
            vodIdx,
            total: playbackCandidates.length,
          });
          webStallTimestamps.length = 0;
          tryNextVod();
          return;
        }
        const url = currentPlaybackUrl ?? playbackCandidates[Math.min(vodIdx, playbackCandidates.length - 1)] ?? workingSrc;
        const decoded = safeDecodeUrl(url);
        const ahead = bufferedAhead();
        console.warn("[LIVE STABILITY] RECOVERY", {
          reason,
          strategy: lastPlayerStrategy,
          url,
          bufferAhead: Number(ahead.toFixed(2)),
          html5LiveReconnects,
        });
        liveRecoveryBusy = true;
        const finish = () => { liveRecoveryBusy = false; };


        // HTML5 direto com .ts consegue abrir em vários Androids, mas às vezes
        // congela sem disparar erro. Reconecta ao edge LIVE sem recarregar a tela;
        // se repetir, troca para mpegts.js como fallback do mesmo candidato.
        if (lastPlayerStrategy.startsWith("HTML5") && /\.ts(\?|&|$)/i.test(decoded)) {
          if (html5LiveReconnects < 2) {
            html5LiveReconnects += 1;
            try {
              video.pause();
              video.src = url;
              video.load();
              void video.play().finally(finish);
            } catch {
              finish();
            }
            return;
          }
          void playMpegTs(url).finally(finish);
          return;
        }

        if (lastPlayerStrategy.startsWith("mpegts") && tsPlayer) {
          try {
            if (!nudgeIntoBufferedRange()) {
              tsPlayer.unload();
              tsPlayer.load();
            }
            const p = tsPlayer.play();
            if (p && typeof p.then === "function") void p.finally(finish);
            else finish();
          } catch {
            finish();
          }
          return;
        }

        if (lastPlayerStrategy.startsWith("HLS") && hls) {
          try {
            hls.startLoad();
            nudgeIntoBufferedRange();
            void video.play().finally(finish);
          } catch {
            finish();
          }
          return;
        }

        if (!nudgeIntoBufferedRange()) {
          try { video.load(); } catch { /* noop */ }
        }
        void video.play().finally(finish);
      };
      const scheduleRecovery = (trigger: "waiting" | "stalled" | "suspend" | "watchdog") => {
        clearPendingRecover();
        pendingRecoverTimer = setTimeout(() => {
          pendingRecoverTimer = null;
          if (cancelled || video.paused || video.ended) return;
          if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || bufferedAhead() < 2) {
            logFreeze(trigger);
            recoverLiveWebStall(trigger);
          }
        }, 4_000);
      };
      const onWaitingStab   = () => { logFreeze("waiting"); scheduleRecovery("waiting"); };
      const onStalledStab   = () => { logFreeze("stalled"); scheduleRecovery("stalled"); };
      const onSuspendStab   = () => {
        // suspend é comum quando o browser pausa downloads — só registra se
        // não estamos com buffer suficiente, evita ruído.
        if (bufferedAhead() < 5) { logFreeze("suspend"); scheduleRecovery("suspend"); }
      };
      const onCanPlayStab        = () => console.log("[LIVE STABILITY] canplay",        snapshot());
      const onCanPlayThroughStab = () => console.log("[LIVE STABILITY] canplaythrough", snapshot());
      const onPlayingStab        = () => { clearPendingRecover(); };

      // Telemetria periódica + estimativa de bytes/s via mpegts.speed.
      let lastBufEnd = 0;
      let lastT = performance.now();
      let lastMediaTime = video.currentTime;
      let noProgressTicks = 0;
      const tick = setInterval(() => {
        if (cancelled) return;
        const now = performance.now();
        let curBufEnd = 0;
        try { curBufEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0; } catch { /* noop */ }
        const dt = (now - lastT) / 1000;
        const bufGrowthSec = dt > 0 ? (curBufEnd - lastBufEnd) / dt : 0;
        lastT = now; lastBufEnd = curBufEnd;
        const moved = Math.abs(video.currentTime - lastMediaTime);
        lastMediaTime = video.currentTime;
        if (!video.paused && !video.ended && moved < 0.15) noProgressTicks += 1;
        else noProgressTicks = 0;
        if (noProgressTicks >= 2) {
          noProgressTicks = 0;
          logFreeze("watchdog");
          recoverLiveWebStall("watchdog");
        }
        if (DEBUG) {
          console.log("[LIVE STABILITY] tick", {
            ...snapshot(),
            bufGrowthSecPerSec: Number(bufGrowthSec.toFixed(2)),
            noProgressTicks,
          });
        }
      }, 5_000);

      video.addEventListener("waiting", onWaitingStab);
      video.addEventListener("stalled", onStalledStab);
      video.addEventListener("suspend", onSuspendStab);
      video.addEventListener("canplay", onCanPlayStab);
      video.addEventListener("canplaythrough", onCanPlayThroughStab);
      video.addEventListener("playing", onPlayingStab);
      stabCleanup = () => {
        clearInterval(tick);
        clearPendingRecover();
        video.removeEventListener("waiting", onWaitingStab);
        video.removeEventListener("stalled", onStalledStab);
        video.removeEventListener("suspend", onSuspendStab);
        video.removeEventListener("canplay", onCanPlayStab);
        video.removeEventListener("canplaythrough", onCanPlayThroughStab);
        video.removeEventListener("playing", onPlayingStab);
      };
    }



    const attachHls = (url: string) => {
      currentHlsUrl = url;
      currentPlaybackUrl = url;
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
          // Config estável para LIVE: buffer mais folgado, sem latência agressiva.
          // VOD: caps reduzidos para não estourar RAM em TV Box (1-2GB).
          // hls.js mantém ~20-45s à frente em LIVE para reduzir starvation.
          backBufferLength: isLive ? 20 : 30,
          maxBufferLength: isLive ? 45 : 60,
          maxMaxBufferLength: isLive ? 90 : 180,
          maxBufferSize: isLive ? 90 * 1000 * 1000 : 90 * 1000 * 1000,
          maxBufferHole: isLive ? 2 : 0.5,
          highBufferWatchdogPeriod: isLive ? 3 : 3,
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
          liveSyncDurationCount: 5,
          liveMaxLatencyDurationCount: 15,
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
                tryNextVod(`HLS NETWORK_ERROR: ${data.details ?? "unknown"}`);
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
                tryNextVod(`HLS MEDIA_ERROR: ${data.details ?? "unknown"}`);
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
      stabCleanup?.();
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("loadeddata", onVideoReady);
      video.removeEventListener("canplay", onVideoReady);
      video.removeEventListener("playing", onPlaying);
      if (hls) hls.destroy();
      destroyTsPlayer();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, kind, playerMode, fallbackSrcs]);

  // [LIVE DIAG] Quando setError dispara em LIVE, marca falha e abre painel.
  // Cobre todos os caminhos (HLS NETWORK/MEDIA/default, esgotamento de candidatos).
  useEffect(() => {
    if (!error) return;
    if (kind !== "live") return;
    const id = diagSessionIdRef.current;
    if (id) liveDiagMarkFailed(id, error);
    setDiagOpen(true);
  }, [error, kind]);

  // [VOD DIAG] Quando filmes/séries falham, marca falha e abre painel.
  useEffect(() => {
    if (!error) return;
    if (kind !== "vod") return;
    if (vodDiagFinalizingRef.current) return;
    const id = vodDiagSessionIdRef.current;
    if (id) vodDiagMarkFailed(id, error);
    setVodDiagOpen(true);
  }, [error, kind]);

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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-player/80 px-3 py-2 text-xs text-destructive z-10">
          {error}
        </div>
      )}
      {/* Painel visual de debug removido (apenas logs internos). */}
      {kind === "live" && (
        <LiveDiagPanel
          session={diagSessionIdRef.current ? liveDiagLatestFailedFor(src) : null}
          open={diagOpen}
          onClose={() => setDiagOpen(false)}
        />
      )}
      {kind === "vod" && (
        <VodDiagPanel
          session={vodDiagSessionIdRef.current ? vodDiagLatestFailedFor(src) : null}
          open={vodDiagOpen}
          onClose={() => setVodDiagOpen(false)}
        />
      )}
      {error && kind === "live" && !diagOpen && (
        <button
          type="button"
          onClick={() => setDiagOpen(true)}
          className="absolute right-3 top-3 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-white/90 backdrop-blur hover:bg-white/20 border border-white/15"
        >
          Ver diagnóstico
        </button>
      )}
      {error && kind === "vod" && !vodDiagOpen && (
        <button
          type="button"
          onClick={() => setVodDiagOpen(true)}
          className="absolute right-3 top-3 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-white/90 backdrop-blur hover:bg-white/20 border border-white/15"
        >
          Ver diagnóstico VOD
        </button>
      )}

      {canManualPlay && !error && playerMode === "web" && (
        <button
          type="button"
          onClick={() => videoRef.current?.play().then(() => setCanManualPlay(false)).catch(() => undefined)}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-glow flex items-center justify-center text-2xl z-10"
          aria-label="Reproduzir"
        >
          ▶
        </button>
      )}
    </div>
  );
}
