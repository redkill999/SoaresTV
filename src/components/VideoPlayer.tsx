import { useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { isNativeApp } from "@/lib/xtream";
import { store, type AppSettings } from "@/lib/storage";

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
  const initialPositionRef = useRef(initialPosition ?? 0);
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    initialPositionRef.current = initialPosition ?? 0;
  }, [initialPosition]);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);
  useEffect(() => store.subscribeAppSettings(() => setSettings(store.getAppSettings())), []);

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
    const video = videoRef.current;
    if (!video || !src) return;
    setError(null);
    setCanManualPlay(false);

    let hlsCandidate = toHlsCandidate(src, kind);
    let hlsProxied: string | null = null;

    // Fallbacks de VOD: alguns provedores Xtream entregam o mesmo filme
    // em containers diferentes. Se o original falhar, tentamos .mp4 e .mkv.
    const isVod = kind === "vod" || /\/movie\/[^/]+\/[^/]+\//i.test(src) || /\/series\/[^/]+\/[^/]+\//i.test(src);
    const isLive = /\/live\/[^/]+\/[^/]+\//i.test(src);
    const vodCandidates: string[] = [];
    const vodMatch = src.match(/^(.*)\.([a-z0-9]+)(\?.*)?$/i);
    if (vodMatch && (!hlsCandidate || isVod)) {
      const [, base, ext, qs = ""] = vodMatch;
      const currentExt = ext.toLowerCase();
      const preferred = isVod
        ? currentExt === "m3u8"
          ? ["m3u8", "mp4", "m4v", "mkv"]
          : [currentExt, "mp4", "m4v", "mkv", "m3u8"]
        : [currentExt, "mp4", "m4v", "mkv"];
      for (const alt of preferred) {
        const candidate = `${base}.${alt}${qs}`;
        if (!vodCandidates.includes(candidate)) vodCandidates.push(candidate);
      }
    }
    if (!vodCandidates.length) vodCandidates.push(src);
    const directCandidates = isLive ? liveDirectCandidates(src) : vodCandidates;
    const playbackCandidates = isVod
      ? vodCandidates.flatMap((url) => {
          const secure = httpsVariant(url);
          // Web desktop: proxy primeiro (https same-origin, sem mixed content).
          // Tentativas diretas (https/http) ficam só como último recurso.
          // O ramo isNativeApp() mais abaixo sobrescreve esta lista para o APK.
          const candidates = [
            proxied(url, "vod"),
            secure ? proxied(secure, "vod") : null,
            secure,
          ].filter(Boolean) as string[];
          return Array.from(new Set(candidates));
        })
      : directCandidates.map((url) => proxied(url, kind));

    let hls: Hls | null = null;
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

    const tryNextVod = () => {
      clearWatchdog();
      if (hls) {
        hls.destroy();
        hls = null;
      }
      vodIdx += 1;
      if (vodIdx < playbackCandidates.length) playDirect();
      else setError("Não foi possível reproduzir esta mídia.");
    };

    const armVodWatchdog = () => {
      if (!isVod) return;
      clearWatchdog();
      watchdog = setTimeout(() => {
        if (cancelled) return;
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) tryNextVod();
      }, 12_000);
    };

    const playDirect = () => {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      triedDirect = true;
      const url = playbackCandidates[vodIdx] ?? (nativeDirect ? src : proxied(src, kind));
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
          backBufferLength: 60,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferSize: 120 * 1000 * 1000,
          maxBufferHole: 1.0,
          highBufferWatchdogPeriod: 3,
          nudgeMaxRetry: 10,
          nudgeOffset: 0.2,
          fragLoadingMaxRetry: nativeDirect ? 2 : 8,
          manifestLoadingMaxRetry: nativeDirect ? 2 : 6,
          levelLoadingMaxRetry: nativeDirect ? 2 : 6,
          fragLoadingRetryDelay: 500,
          fragLoadingTimeOut: 20_000,
          manifestLoadingTimeOut: 15_000,
          levelLoadingTimeOut: 15_000,
          liveSyncDurationCount: 4,
          liveMaxLatencyDurationCount: 10,
          startLevel: -1,
          abrEwmaDefaultEstimate: 1_000_000,
        });
        hls.loadSource(url);
        hls.attachMedia(video);

        let netRetries = 0;
        const MAX_NET_RETRIES = nativeDirect ? 2 : 5;
        let mediaRetries = 0;
        const MAX_MEDIA_RETRIES = 3;

        // Stall watchdog para LIVE: se ficar travado em "waiting" > 8s,
        // força recarga do segmento (recupera congelamentos típicos de IPTV).
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const clearStall = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };
        const onWaiting = () => {
          if (!isLive || cancelled) return;
          clearStall();
          stallTimer = setTimeout(() => {
            if (cancelled || !hls) return;
            try {
              hls.stopLoad();
              hls.startLoad();
              // Pequeno nudge pra destravar buffer hole
              try { video.currentTime = video.currentTime + 0.1; } catch { /* noop */ }
              void video.play().catch(() => undefined);
            } catch { /* noop */ }
          }, 8_000);
        };
        const onResumed = () => clearStall();
        video.addEventListener("waiting", onWaiting);
        video.addEventListener("playing", onResumed);
        video.addEventListener("canplay", onResumed);
        detachStallListeners = () => {
          clearStall();
          video.removeEventListener("waiting", onWaiting);
          video.removeEventListener("playing", onResumed);
          video.removeEventListener("canplay", onResumed);
        };

        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (cancelled) return;
          if (!data.fatal) return;
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (isLive) {
                if (netRetries++ >= MAX_NET_RETRIES) {
                  if (nativeDirect && hlsCandidate && currentHlsUrl === hlsCandidate) {
                    detachStallListeners?.();
                    hls?.destroy();
                    hls = null;
                    attachHls(proxied(hlsCandidate, kind));
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
      // Roteamos pelo proxy /api/stream (mesma origem https) — o servidor
      // resolve o http e devolve o stream com headers de IPTV.
      hlsProxied = hlsCandidate ? (native ? hlsCandidate : proxied(hlsCandidate, kind)) : null;
      if (native) {
        // APK/TV: tenta direto primeiro e mantém proxy como último recurso.
        playbackCandidates.splice(0, playbackCandidates.length, ...directCandidates.flatMap((url) => {
          const secure = httpsVariant(url);
          return Array.from(new Set([url, secure, proxied(url, kind)].filter(Boolean) as string[]));
        }));
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
      video.removeAttribute("src");
      video.load();
    };
  }, [src, kind]);

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
        style={{ ['--cue-scale' as never]: settings.subtitleScale }}
        className={videoClass}
      />
      {error && (
        <div className="absolute inset-x-0 bottom-0 bg-player/80 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {canManualPlay && !error && (
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
