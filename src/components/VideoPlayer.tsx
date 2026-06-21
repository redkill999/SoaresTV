import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { isNativeApp } from "@/lib/xtream";
import { playNative, stopNative } from "@/lib/native-player";
import { store, getCompatForUrl, USER_AGENT_STRINGS, type AppSettings, type ListCompat } from "@/lib/storage";

// Module-level cache do mpegts.js: a 1ª troca de canal paga o import, as
// seguintes reusam a mesma referência (sem reparse de bundle nem nova Promise).
let mpegtsModule: typeof import("mpegts.js").default | null = null;
let mpegtsLoading: Promise<typeof import("mpegts.js").default> | null = null;
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
}: {
  src: string;
  poster?: string;
  kind?: "live" | "vod";
  initialPosition?: number;
  onProgress?: (positionSec: number, durationSec: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    setPlayerMode("deciding");
    (async () => {
      const native = await isNativeApp();
      if (cancelled) return;
      if (!native) {
        setPlayerMode("web");
        return;
      }
      const ok = await openNative();
      if (cancelled) {
        if (ok) void stopNative();
        return;
      }
      setPlayerMode(ok ? "native" : "web");
    })();
    return () => {
      cancelled = true;
      void stopNative();
    };
  }, [src, kind, openNative]);

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
    const skipHls =
      compat.streamFormat === "ts" ||
      compat.streamFormat === "mp4" ||
      // Se a URL termina em .ts/.mp4/.mkv não faz sentido tentar HLS antes.
      (compat.streamFormat == null && (auto === "ts" || auto === "mp4" || auto === "mkv"));

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


    let hls: Hls | null = null;
    let tsPlayer: MpegTsPlayer | null = null;
    let cancelled = false;
    let vodIdx = 0;
    let triedDirect = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let nativeDirect = false;
    let currentHlsUrl: string | null = null;
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

    const tryNextVod = () => {
      clearWatchdog();
      if (hls) {
        hls.destroy();
        hls = null;
      }
      destroyTsPlayer();
      vodIdx += 1;
      if (vodIdx < playbackCandidates.length) playDirect();
      else setError(isLive ? "Não foi possível reproduzir este canal." : "Não foi possível reproduzir esta mídia.");
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
      if (/\.m3u8(\?|&|$)/i.test(decodedUrl)) {
        attachHls(url);
        return;
      }
      if (/\.ts(\?|&|$)/i.test(decodedUrl)) {
        void playMpegTs(url).then((handled) => {
          if (!handled && !cancelled) {
            video.pause();
            video.currentTime = 0;
            video.src = url;
            video.load();
            video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
          }
        });
        return;
      }
      video.pause();
      video.currentTime = 0;
      video.src = url;
      video.load();
      armVodWatchdog();
      video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
    };

    const onVideoError = () => {
      if (cancelled || hls) return;
      tryNextVod();
    };
    const onVideoReady = () => clearWatchdog();
    const onPlaying = () => {
      clearWatchdog();
      setCanManualPlay(false);
    };
    video.addEventListener("error", onVideoError);
    video.addEventListener("loadeddata", onVideoReady);
    video.addEventListener("canplay", onVideoReady);
    video.addEventListener("playing", onPlaying);

    const attachHls = (url: string) => {
      currentHlsUrl = url;
      if (Hls.isSupported()) {
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
                  else setError("Conexão instável com o canal. Tente novamente.");
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
                  else setError("Erro de mídia no canal. Tente novamente.");
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
              else setError("Não foi possível reproduzir este canal.");
          }
        });

      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
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
            : native ? hlsCandidate : proxiedX(hlsCandidate, kind)
        : null;
      if (native && !forceProxy) {
        // APK/TV: tenta direto primeiro e mantém proxy como último recurso
        // (a menos que o usuário tenha escolhido forceProxy).
        playbackCandidates.splice(0, playbackCandidates.length, ...directCandidates.flatMap((url) => {
          const secure = httpsVariant(url);
          const list = forceDirect
            ? [url, secure]
            : [url, secure, proxiedX(url, kind)];
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

  // No APK Android, força paisagem ao entrar em tela cheia e libera ao sair.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onFsChange = () => {
      const isFs = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
      if (isFs) void lockLandscape();
      else void unlockOrientation();
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    video.addEventListener("webkitbeginfullscreen", lockLandscape as EventListener);
    video.addEventListener("webkitendfullscreen", unlockOrientation as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      video.removeEventListener("webkitbeginfullscreen", lockLandscape as EventListener);
      video.removeEventListener("webkitendfullscreen", unlockOrientation as EventListener);
      void unlockOrientation();
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




  return (
    <div className="relative h-full w-full bg-player">
      <video
        ref={videoRef}
        poster={poster}
        controls
        autoPlay
        playsInline
        style={{
          ['--cue-scale' as never]: settings.subtitleScale,
          // Realce visual estilo "HDR" (apenas CSS — não é HDR real).
          // Suave pra não estourar pele/branco. Se incomodar, é só reverter.
          filter: 'saturate(1.15) contrast(1.08) brightness(1.02)',
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
