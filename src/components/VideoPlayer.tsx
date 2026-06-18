import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

// Xtream live URLs come as `.ts` (raw MPEG-TS), which browsers cannot decode
// natively. Most providers also expose an HLS variant at the same path with
// `.m3u8`. We try HLS first and fall back to the original on error. Everything
// flows through our /api/stream proxy to dodge CORS / mixed-content.
function toHlsCandidate(src: string): string | null {
  if (/\.m3u8(\?|$)/i.test(src)) return src;
  if (/\/(live|movie|series)\/[^/]+\/[^/]+\/\d+\.[a-z0-9]+(\?|$)/i.test(src)) {
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
    const directProxied = proxied(src);

    let hls: Hls | null = null;
    let cancelled = false;
    let triedDirect = false;

    const playDirect = () => {
      triedDirect = true;
      video.src = directProxied;
      video.play().catch(() => {});
    };

    const attachHls = (url: string) => {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // Buffer bem maior reduz travamentos em IPTV ao vivo
          backBufferLength: 30,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferSize: 120 * 1000 * 1000,
          maxBufferHole: 1.0,
          highBufferWatchdogPeriod: 3,
          nudgeMaxRetry: 10,
          // Recuperação automática de falhas de rede/fragmento
          fragLoadingMaxRetry: 8,
          manifestLoadingMaxRetry: 6,
          levelLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 500,
          // Live tuning: ficar um pouco atrás da borda evita stalls
          liveSyncDurationCount: 4,
          liveMaxLatencyDurationCount: 10,
          // Inicia em qualidade mais baixa e sobe conforme banda
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
              hls?.startLoad();
              return;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls?.recoverMediaError();
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
