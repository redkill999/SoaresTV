import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Button } from "@/components/ui/button";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, streamUrl, getShortEpg, isNativeApp, type EpgListing } from "@/lib/xtream";
import { useIsFavorite } from "@/hooks/use-favorites";
import { Clock, ExternalLink, ArrowLeft } from "lucide-react";

const VALID_TYPES = ["live", "movie", "series"] as const;
type PlayerType = (typeof VALID_TYPES)[number];
const isPlayerType = (t: string): t is PlayerType =>
  (VALID_TYPES as readonly string[]).includes(t);

export const Route = createFileRoute("/player/$type/$id")({
  validateSearch: (s: Record<string, unknown>) => ({ name: (s.name as string) ?? "" }),
  head: ({ params }) => ({ meta: [{ title: `Player — ${params.id}` }] }),
  component: PlayerPage,
});


type SeriesInfo = {
  seasons?: Array<{ season_number: number; name?: string }>;
  episodes?: Record<string, Array<{ id: string; title: string; container_extension: string; episode_num: number; direct_source?: string }>>;
};

type MovieInfo = {
  movie_data?: {
    stream_id?: string | number;
    container_extension?: string;
    direct_source?: string;
  };
};

function PlayerPage() {
  const { type: rawType, id } = Route.useParams();
  const { name } = Route.useSearch();
  const navigate = useNavigate();
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
    setCreds(store.getCreds());
  }, []);
  const [episodeUrl, setEpisodeUrl] = useState<string | null>(null);
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState(name);

  // Valida o tipo da URL — params são `string`, podem vir errados.
  const type: PlayerType | null = isPlayerType(rawType) ? rawType : null;
  useEffect(() => {
    if (hydrated && !type) navigate({ to: "/home" });
  }, [hydrated, type, navigate]);

  useEffect(() => {
    if (hydrated && !creds) navigate({ to: "/" });
  }, [hydrated, creds, navigate]);

  const seriesQ = useQuery({
    queryKey: ["series-info", id],
    enabled: !!creds && type === "series",
    queryFn: () => api<SeriesInfo>(creds!, "get_series_info", { series_id: id }),
  });

  type Episode = { id: string; title: string; container_extension: string; episode_num: number; direct_source?: string };

  const playEpisode = useCallback(
    (ep: Episode) => {
      if (!creds) return;
      const directPath = (() => {
        try {
          return ep.direct_source ? new URL(ep.direct_source).pathname.toLowerCase() : "";
        } catch {
          return "";
        }
      })();
      const usableDirect =
        ep.direct_source &&
        /^https?:\/\//i.test(ep.direct_source) &&
        /\.(m3u8|mp4|m4v|mov|webm)(\?|$)/i.test(directPath);
      setEpisodeUrl(
        usableDirect
          ? ep.direct_source!
          : streamUrl.episode(creds, ep.id, ep.container_extension || "mp4"),
      );
      setActiveEpisodeId(String(ep.id));
      setActiveTitle(`${name} — ${ep.title}`);
      store.setLastEpisode(id, String(ep.id));
    },
    [creds, id, name],
  );

  // Auto-seleciona último episódio assistido (ou o primeiro) ao abrir a série.
  useEffect(() => {
    if (type !== "series" || episodeUrl || !seriesQ.data?.episodes) return;
    const allEps: Episode[] = Object.values(seriesQ.data.episodes).flat() as Episode[];
    if (!allEps.length) return;
    const lastId = store.getLastEpisode(id);
    const target = (lastId && allEps.find((e) => String(e.id) === lastId)) || allEps[0];
    playEpisode(target);
  }, [type, seriesQ.data, episodeUrl, id, playEpisode]);


  const movieQ = useQuery({
    queryKey: ["movie-info", id],
    enabled: !!creds && type === "movie",
    queryFn: () => {
      const [sid] = id.split(".");
      return api<MovieInfo>(creds!, "get_vod_info", { vod_id: sid });
    },
  });

  const epgQ = useQuery({
    queryKey: ["epg", id],
    enabled: !!creds && type === "live",
    queryFn: () => getShortEpg(creds!, id, 6),
    refetchInterval: 60_000,
  });

  const url = useMemo(() => {
    if (!creds) return "";
    if (type === "live") return streamUrl.live(creds, id);
    if (type === "movie") {
      // id may include ".ext"
      const [sid, ext] = id.split(".");
      const direct = movieQ.data?.movie_data?.direct_source;
      if (direct && /^https?:\/\//i.test(direct)) {
        const directPath = (() => {
          try {
            return new URL(direct).pathname.toLowerCase();
          } catch {
            return "";
          }
        })();
        const looksLikePlayableFile = /\.(m3u8|mp4|m4v|mov|webm)(\?|$)/i.test(directPath);
        if (looksLikePlayableFile) return direct;
      }
      const movieId = movieQ.data?.movie_data?.stream_id ?? sid;
      const movieExt = movieQ.data?.movie_data?.container_extension || ext || "mp4";
      return streamUrl.movie(creds, movieId, movieExt);
    }
    if (type === "series") return episodeUrl ?? "";
    return "";
  }, [creds, type, id, episodeUrl, movieQ.data]);

  // Mantém o título atual em ref para evitar duplicar histórico quando
  // só `activeTitle` muda (mas a URL não).
  const activeTitleRef = useRef(activeTitle);
  useEffect(() => {
    activeTitleRef.current = activeTitle;
  }, [activeTitle]);

  useEffect(() => {
    if (!url || !creds || !type) return;
    store.pushHistory({
      type,
      id,
      name: activeTitleRef.current || id,
      at: Date.now(),
    });
  }, [url, type, id, creds]);

  // Posição salva para "continue assistindo" (apenas VOD/série).
  const initialPosition = useMemo(() => {
    if (!type || type === "live") return 0;
    return store.getHistoryItem(type, id)?.position ?? 0;
  }, [type, id]);

  const handleProgress = useCallback(
    (positionSec: number, durationSec: number) => {
      if (!type || type === "live") return;
      store.updateProgress(type, id, positionSec, durationSec);
    },
    [type, id],
  );

  // Player externo (Android nativo): dispara Intent VIEW para o stream.
  // Apps como MX Player, VLC, Just Player aceitam e usam ExoPlayer/FFmpeg por baixo.
  const [isNative, setIsNative] = useState(false);
  useEffect(() => {
    void isNativeApp().then(setIsNative);
  }, []);

  const openInExternalPlayer = useCallback(() => {
    if (!url) return;
    try {
      // Constrói Intent URI Android: força mimeType de vídeo e action VIEW.
      // O sistema mostra o seletor com MX Player / VLC / etc.
      const stripped = url.replace(/^https?:\/\//i, "");
      const scheme = /^https:\/\//i.test(url) ? "https" : "http";
      const intentUrl =
        `intent://${stripped}` +
        `#Intent;scheme=${scheme};type=video/*;action=android.intent.action.VIEW;end`;
      window.location.href = intentUrl;
    } catch {
      window.open(url, "_blank");
    }
  }, [url]);

  const leavingRef = useRef(false);
  const closePlayer = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;

    try { sessionStorage.removeItem("soarestv:autofs"); } catch { /* ignore */ }

    try {
      const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> | void };
      if (d.fullscreenElement && typeof document.exitFullscreen === "function") void document.exitFullscreen();
      else if (d.webkitFullscreenElement && typeof d.webkitExitFullscreen === "function") void d.webkitExitFullscreen();
    } catch { /* ignore */ }

    const exitToLibrary = () => {
      if (type === "live") navigate({ to: "/live", replace: true });
      else if (type === "movie") navigate({ to: "/movies", replace: true });
      else if (type === "series") navigate({ to: "/series", replace: true });
      else navigate({ to: "/home", replace: true });
    };

    window.setTimeout(exitToLibrary, 0);
  }, [navigate, type]);

  useEffect(() => {
    const onRemoteBack = (event: Event) => {
      event.preventDefault();
      closePlayer();
    };
    window.addEventListener("soarestv:player-back", onRemoteBack);
    return () => window.removeEventListener("soarestv:player-back", onRemoteBack);
  }, [closePlayer]);

  useEffect(() => {
    const d = document as Document & { webkitFullscreenElement?: Element };
    const wasFullscreen = { current: !!(d.fullscreenElement || d.webkitFullscreenElement) };
    const onFullscreenChange = () => {
      const isFullscreen = !!(d.fullscreenElement || d.webkitFullscreenElement);
      if (isFullscreen) {
        wasFullscreen.current = true;
        return;
      }
      if (wasFullscreen.current && !leavingRef.current) closePlayer();
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, [closePlayer]);

  // (Favorito agora é gerenciado fora do player)
  void useIsFavorite;


  return (
    <AppShell immersive>
      <div className="relative h-dvh w-dvw overflow-hidden bg-player text-player-foreground">
        <div className="absolute inset-0 bg-player">
          {url ? (
            <VideoPlayer
              src={url}
              kind={type === "live" ? "live" : "vod"}
              initialPosition={initialPosition}
              onProgress={handleProgress}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-player text-muted-foreground">
              {type === "series" ? "Carregando episódio…" : "Carregando…"}
            </div>
          )}
        </div>
          {/* Título/tipo e botão de voltar/favorito ficam ocultos durante a reprodução.
              Use a tecla Voltar do controle remoto / ESC para sair do player.
              Mantemos apenas o botão "Player externo" no app nativo, no canto. */}
          {isNative && url && (
            <div className="pointer-events-auto absolute right-3 top-3 z-20">
              <Button
                variant="outline"
                onClick={openInExternalPlayer}
                title="Abrir em MX Player, VLC ou outro player nativo (ExoPlayer)"
                className="bg-player/45 backdrop-blur"
              >
                <ExternalLink className="size-4" />
                Player externo
              </Button>
            </div>
          )}
        {type === "series" && (
          <details className="absolute bottom-4 right-4 z-30 max-h-[62dvh] w-[min(26rem,calc(100dvw-2rem))] overflow-y-auto rounded-lg border border-white/10 bg-player/82 backdrop-blur">
            <summary className="cursor-pointer px-4 py-3 font-semibold flex items-center gap-2">
              Episódios
            </summary>
            <div className="px-4 pb-4">
            {seriesQ.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {seriesQ.data?.episodes &&
              Object.entries(seriesQ.data.episodes).map(([season, eps]) => (
                <div key={season} className="mb-4">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                    Temporada {season}
                  </div>
                  <div className="space-y-1">
                    {eps.map((ep) => {
                      const active = String(ep.id) === activeEpisodeId;
                      return (
                        <button
                          type="button"
                          key={ep.id}
                          onClick={() => playEpisode(ep)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${
                            active ? "bg-primary/20 text-primary" : "hover:bg-white/5"
                          }`}
                        >
                          <span className="text-muted-foreground mr-2">E{ep.episode_num}</span>
                          {ep.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
        {null}

      </div>
    </AppShell>
  );
}
