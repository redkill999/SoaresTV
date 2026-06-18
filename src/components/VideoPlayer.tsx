import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { isNativeApp } from "@/lib/xtream";

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
  return `/api/stream?u=${encodeURIComponent(url)}${kind === "vod" ? "&kind=vod" : ""}&v=3`;
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

export function VideoPlayer({ src, poster, kind }: { src: string; poster?: string; kind?: "live" | "vod" }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [canManualPlay, setCanManualPlay] = useState(false);

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
        ? [currentExt, "mp4", "m3u8", "m4v", "mkv"]
        : [currentExt, "mp4", "m4v", "mkv"];
      for (const alt of preferred) {
        const candidate = `${base}.${alt}${qs}`;
        if (!vodCandidates.includes(candidate)) vodCandidates.push(candidate);
      }
    }
    if (!vodCandidates.length) vodCandidates.push(src);
    const playbackCandidates = isVod
      ? vodCandidates.flatMap((url) => {
          const secure = httpsVariant(url);
          const candidates = [secure, proxied(url, "vod"), secure ? proxied(secure, "vod") : null].filter(Boolean) as string[];
          return Array.from(new Set(candidates));
        })
      : vodCandidates.map((url) => proxied(url, kind));

    let hls: Hls | null = null;
    let cancelled = false;
    let vodIdx = 0;
    let triedDirect = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let nativeDirect = false;

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
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferSize: 120 * 1000 * 1000,
          maxBufferHole: 1.0,
          highBufferWatchdogPeriod: 3,
          nudgeMaxRetry: 10,
          fragLoadingMaxRetry: 8,
          manifestLoadingMaxRetry: 6,
          levelLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 500,
          liveSyncDurationCount: 4,
          liveMaxLatencyDurationCount: 10,
          startLevel: -1,
          abrEwmaDefaultEstimate: 1_000_000,
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (cancelled) return;
          if (!data.fatal) return;
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (isLive) hls?.startLoad();
              else tryNextVod();
              return;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (isLive) hls?.recoverMediaError();
              else tryNextVod();
              return;
            default:
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
      hlsProxied = hlsCandidate ? proxied(hlsCandidate, kind) : null;
      if (native) {
        // VOD: tenta direto (https/http) e mantém proxy como último recurso.
        playbackCandidates.splice(0, playbackCandidates.length, ...vodCandidates.flatMap((url) => {
          const secure = httpsVariant(url);
          return Array.from(new Set([secure, url, proxied(url, "vod")].filter(Boolean) as string[]));
        }));
      }
      if (hlsProxied) attachHls(hlsProxied);
      else playDirect();
    });

    return () => {
      cancelled = true;
      clearWatchdog();
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


  return (
    <div className="relative">
      <video
        ref={videoRef}
        poster={poster}
        controls
        autoPlay
        playsInline
        className="w-full aspect-video bg-black rounded-xl shadow-card"
      />
      {error && (
        <div className="absolute inset-x-0 bottom-0 bg-black/80 text-destructive text-xs px-3 py-2 rounded-b-xl">
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
