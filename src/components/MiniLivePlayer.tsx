import { useNavigate } from "@tanstack/react-router";
import { Maximize2, Tv, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { VideoPlayer } from "@/components/VideoPlayer";
import { getShortEpg, type EpgListing } from "@/lib/xtream";
import { tryResolveStreamUrl } from "@/lib/streaming/stream-resolver";
import type { XtreamCreds } from "@/lib/storage";

export function MiniLivePlayer({
  creds,
  streamId,
  name,
  logo,
  src: originalSrc,
}: {
  creds: XtreamCreds | null;
  streamId: number | string | null;
  name?: string;
  logo?: string;
  /** URL real do canal (vinda da M3U) — quando presente, evita reconstrução. */
  src?: string;
}) {
  const navigate = useNavigate();
  const [muted, setMuted] = useState(true);
  const videoWrapRef = useRef<HTMLDivElement>(null);

  const epgQ = useQuery({
    queryKey: ["epg-short", streamId],
    enabled: !!creds && !!streamId,
    queryFn: () => getShortEpg(creds!, streamId!, 3),
    staleTime: 60_000,
  });

  // Sync muted state into <video> element
  useEffect(() => {
    const v = videoWrapRef.current?.querySelector("video");
    if (v) v.muted = muted;
  }, [muted, streamId]);

  // FONTE ÚNICA: streaming layer isolada resolve LIVE (src M3U → Xtream .ts).
  const src = tryResolveStreamUrl({ src: originalSrc, stream_id: streamId }, creds);

  useEffect(() => {
    if (!streamId) return;
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log("[LIVE DEBUG]", {
        hasSrc: !!originalSrc,
        finalSrc: src,
        streamId,
      });
    }
  }, [originalSrc, src, streamId]);

  const now = Math.floor(Date.now() / 1000);
  const current = epgQ.data?.find((e: EpgListing) => {
    const s = Number(e.start_timestamp);
    const en = Number(e.stop_timestamp);
    return now >= s && now < en;
  });
  const next = epgQ.data?.find((e: EpgListing) => Number(e.start_timestamp) > now);

  const goFullscreen = () => {
    if (!streamId) return;
    void navigate({
      to: "/player/$type/$id",
      params: { type: "live", id: String(streamId) },
      // Envia a MESMA url final resolvida (fonte única) para o player fullscreen.
      search: src ? { name: name ?? "Canal", src } : { name: name ?? "Canal" },
    });
  };

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10 bg-card/40 backdrop-blur shadow-card">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Video */}
        <div ref={videoWrapRef} className="relative aspect-video bg-black">
          {creds && streamId && src ? (
            <VideoPlayer key={String(streamId)} src={src} poster={logo} kind="live" />
          ) : creds && streamId && !src ? (
            <div className="absolute inset-0 grid place-items-center text-destructive">
              <div className="text-center px-4">
                <Tv className="size-10 mx-auto mb-2 opacity-60" />
                <p className="text-sm font-semibold">Erro: URL do canal indisponível</p>
                <p className="text-xs text-muted-foreground mt-1">Sem src M3U e sem credenciais para montar o stream.</p>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground">
              <div className="text-center">
                <Tv className="size-10 mx-auto mb-2 opacity-60" />
                <p className="text-sm">Selecione um canal</p>
              </div>
            </div>
          )}

          {streamId && (
            <div className="absolute top-2 right-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                className="size-9 rounded-full bg-black/60 backdrop-blur grid place-items-center hover:bg-black/80 transition-colors"
                aria-label={muted ? "Ativar som" : "Mudo"}
              >
                {muted ? <VolumeX className="size-4 text-white" /> : <Volume2 className="size-4 text-white" />}
              </button>
              <button
                type="button"
                onClick={goFullscreen}
                className="size-9 rounded-full bg-black/60 backdrop-blur grid place-items-center hover:bg-black/80 transition-colors"
                aria-label="Tela cheia"
              >
                <Maximize2 className="size-4 text-white" />
              </button>
            </div>
          )}
        </div>

        {/* Info + EPG */}
        <div className="p-4 sm:p-5 flex flex-col gap-3 min-w-0">
          <div className="flex items-start gap-3 min-w-0">
            {logo && (
              <img
                src={logo}
                alt=""
                className="size-12 rounded-lg object-contain bg-white/5 shrink-0"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-display font-bold text-lg leading-tight truncate">
                {name ?? "—"}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-primary mt-0.5">
                Ao vivo
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 pt-3 space-y-2 text-sm min-w-0">
            {current ? (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Agora</div>
                <div className="font-medium truncate">{current.title}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtTime(current.start_timestamp)} – {fmtTime(current.stop_timestamp)}
                </div>
              </div>
            ) : streamId ? (
              <div className="text-xs text-muted-foreground">Sem dados de EPG.</div>
            ) : null}

            {next && (
              <div className="opacity-70">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">A seguir</div>
                <div className="font-medium truncate text-sm">{next.title}</div>
                <div className="text-xs text-muted-foreground">{fmtTime(next.start_timestamp)}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtTime(ts: string | number): string {
  const n = Number(ts);
  if (!Number.isFinite(n)) return "";
  return new Date(n * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
