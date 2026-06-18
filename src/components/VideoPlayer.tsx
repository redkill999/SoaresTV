import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

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

function proxied(url: string): string {
  return `/api/stream?u=${encodeURIComponent(url)}`;
}

export function VideoPlayer({ src, poster }: { src: string; poster?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setError(null);

    const hlsCandidate = toHlsCandidate(src);
    const hlsProxied = hlsCandidate ? proxied(hlsCandidate) : null;

    // Fallbacks de VOD: alguns provedores Xtream entregam o mesmo filme
    // em containers diferentes. Se o original falhar, tentamos .mp4 e .mkv.
    const isVod = /\/movie\/[^/]+\/[^/]+\//i.test(src) || /\/series\/[^/]+\/[^/]+\//i.test(src);
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

    let hls: Hls | null = null;
    let cancelled = false;
    let vodIdx = 0;
    let triedDirect = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

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
      if (vodIdx < vodCandidates.length) playDirect();
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
      const url = vodCandidates[vodIdx] ?? src;
      if (/\.m3u8(\?|$)/i.test(url)) {
        attachHls(proxied(url));
        return;
      }
      video.src = proxied(url);
      video.load();
      armVodWatchdog();
      video.play().catch(() => {});
    };

    const onVideoError = () => {
      if (cancelled || hls) return;
      tryNextVod();
    };
    const onVideoReady = () => clearWatchdog();
    video.addEventListener("error", onVideoError);
    video.addEventListener("loadeddata", onVideoReady);
    video.addEventListener("canplay", onVideoReady);
    video.addEventListener("playing", onVideoReady);

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
        video.play().catch(() => {});
      } else {
        playDirect();
      }
    };

    if (hlsProxied) attachHls(hlsProxied);
    else playDirect();

    return () => {
      cancelled = true;
      clearWatchdog();
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("loadeddata", onVideoReady);
      video.removeEventListener("canplay", onVideoReady);
      video.removeEventListener("playing", onVideoReady);
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);


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
    </div>
  );
}
