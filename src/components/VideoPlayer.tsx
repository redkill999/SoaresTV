import { useEffect, useRef } from "react";
import Hls from "hls.js";

export function VideoPlayer({ src, poster }: { src: string; poster?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const isHls = /\.m3u8(\?|$)/i.test(src);
    let hls: Hls | null = null;

    if (isHls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;
    }

    video.play().catch(() => {});

    return () => {
      if (hls) hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      poster={poster}
      controls
      autoPlay
      className="w-full aspect-video bg-black rounded-xl shadow-card"
    />
  );
}
