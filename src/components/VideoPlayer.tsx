import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

// Xtream live URLs come as `.ts` (raw MPEG-TS), which browsers cannot decode
// natively. Most providers also expose an HLS variant at the same path with
// `.m3u8`. We try HLS first and fall back to the original on error.
function toHlsCandidate(src: string): string | null {
  if (/\.m3u8(\?|$)/i.test(src)) return src;
  if (/\/live\/[^/]+\/[^/]+\/\d+\.ts(\?|$)/i.test(src)) {
    return src.replace(/\.ts(\?|$)/i, ".m3u8$1");
  }
  return null;
}

export function VideoPlayer({ src, poster }: { src: string; poster?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setError(null);

    const hlsUrl = toHlsCandidate(src);
    let hls: Hls | null = null;
    let cancelled = false;

    const playNative = (url: string) => {
      video.src = url;
      video.play().catch(() => {});
    };

    const attachHls = (url: string) => {
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (cancelled) return;
          if (data.fatal) {
            hls?.destroy();
            hls = null;
            // fall back to direct playback
            if (url !== src) playNative(src);
            else setError("Não foi possível reproduzir este canal (CORS/codec).");
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        playNative(url);
      } else {
        playNative(src);
      }
    };

    if (hlsUrl) attachHls(hlsUrl);
    else playNative(src);

    video.play().catch(() => {});

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
        crossOrigin="anonymous"
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
