import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { ParentalGate } from "@/components/ParentalGate";
import { Button } from "@/components/ui/button";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, streamUrl } from "@/lib/xtream";
import { findCategoryIdFor, isItemLocked } from "@/lib/parental";
import { ArrowLeft } from "lucide-react";

const VALID_TYPES = ["live", "movie", "series"] as const;
type PlayerType = (typeof VALID_TYPES)[number];
const isPlayerType = (t: string): t is PlayerType =>
  (VALID_TYPES as readonly string[]).includes(t);

export const Route = createFileRoute("/player/$type/$id")({
  validateSearch: (s: Record<string, unknown>): { name?: string; src?: string } => ({
    name: typeof s.name === "string" ? s.name : undefined,
    src: typeof s.src === "string" ? s.src : undefined,
  }),
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
  const { name = "", src: customSrc = "" } = Route.useSearch();
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

  // Controle parental: se o item pertence a uma categoria bloqueada,
  // exige o PIN antes de reproduzir. Essa é a camada final que cobre
  // deep links, favoritos e histórico que passaram pelos filtros.
  const [parentalUnlocked, setParentalUnlocked] = useState(false);
  const parentalLocked = useMemo(() => {
    if (!hydrated || !type) return false;
    return isItemLocked(type === "movie" ? "movie" : type, id);
  }, [hydrated, type, id]);
  const parentalCatId = useMemo(() => {
    if (!parentalLocked || !type) return "";
    return findCategoryIdFor(type === "movie" ? "movie" : type, id) ?? "locked";
  }, [parentalLocked, type, id]);

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

  const validCustomSrc = customSrc && /^https?:\/\//i.test(customSrc) ? customSrc : "";
  const isCatchup = !!validCustomSrc;
  const url = useMemo(() => {
    if (type === "live") {
      if (validCustomSrc) return validCustomSrc;
      if (!creds) return "";
      // Log de validação: só monta URL LIVE com credenciais reais.
      // eslint-disable-next-line no-console
      console.log("LIVE STREAM READY:", {
        hasCreds: !!creds.username && !!creds.password && !!creds.server,
        streamId: id,
      });
      return streamUrl.live(creds, id);
    }
    if (validCustomSrc) return validCustomSrc;
    if (!creds) return "";
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
  }, [creds, type, id, episodeUrl, movieQ.data, validCustomSrc]);

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

  // "Continuar de onde parou?" — em vez de seekar automaticamente, mostramos
  // um toast 1.5s após o vídeo poder tocar. Usuário escolhe.
  const handleProgress = useCallback(
    (positionSec: number, durationSec: number) => {
      if (!type || type === "live") return;
      store.updateProgress(type, id, positionSec, durationSec);
    },
    [type, id],
  );

  const resumeToastShownRef = useRef<string | null>(null);
  useEffect(() => { resumeToastShownRef.current = null; }, [type, id, url]);
  const onPlayerReady = useCallback(
    (handle: VideoPlayerHandle) => {
      if (!type || type === "live" || !url) return;
      const key = `${type}:${id}:${url}`;
      if (resumeToastShownRef.current === key) return;
      const item = store.getHistoryItem(type, id);
      if (!item || !item.position || !item.duration) return;
      if (item.position <= 30) return;
      if (item.position >= item.duration - 30) return;
      resumeToastShownRef.current = key;
      const position = item.position;
      const mins = Math.floor(position / 60);
      const secs = Math.floor(position % 60).toString().padStart(2, "0");
      window.setTimeout(() => {
        toast("Continuar de onde parou?", {
          description: `Você parou em ${mins}:${secs}.`,
          duration: 6000,
          action: {
            label: "Continuar",
            onClick: () => handle.seekTo(position),
          },
          cancel: {
            label: "Do início",
            onClick: () => { /* no-op: começa do zero */ },
          },
        });
      }, 1500);
    },
    [type, id, url],
  );

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

  // Obs.: não fechamos o player ao sair do fullscreen — sair de tela cheia
  // deve apenas voltar o player ao modo inline. O fechamento real acontece
  // apenas via botão "voltar" (closePlayer) ou pelo evento soarestv:player-back.

  // Mostra controles (seta voltar) ao mover o mouse, e oculta após alguns segundos
  const [showControls, setShowControls] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealControls = useCallback(() => {
    setShowControls(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 2500);
  }, []);
  useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  }, []);

  return (
    <AppShell immersive>
      <div
        className="relative h-dvh w-dvw overflow-hidden bg-player text-player-foreground"
        onMouseMove={revealControls}
        onMouseEnter={revealControls}
        onTouchStart={revealControls}
      >
        <div className="absolute inset-0 bg-player">
          {parentalLocked && !parentalUnlocked ? (
            <ParentalGate categoryId={parentalCatId} onUnlock={() => setParentalUnlocked(true)} />
          ) : url ? (
            <VideoPlayer
              src={url}
              kind={type === "live" ? "live" : "vod"}
              mediaId={type !== "live" ? id : undefined}
              mediaKind={type === "movie" || type === "series" ? type : undefined}
              onProgress={handleProgress}
              onReady={onPlayerReady}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-player text-muted-foreground">
              {type === "series" ? "Carregando episódio…" : "Carregando…"}
            </div>
          )}
        </div>
        {/* Seta de voltar — visível apenas ao mover o mouse */}
        <div
          className={`pointer-events-none absolute left-2 top-2 sm:left-3 sm:top-3 z-30 transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0"
          }`}
        >
          <Button
            variant="outline"
            onClick={closePlayer}
            aria-label="Voltar"
            title="Voltar"
            className="pointer-events-auto bg-player/45 backdrop-blur min-h-11 px-3 sm:px-4 text-sm sm:text-base"
          >
            <ArrowLeft className="size-4 sm:size-5" />
            <span className="hidden sm:inline">Voltar</span>
          </Button>
        </div>

        {isCatchup && (
          <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-white shadow-lg">
            Reprise
          </div>
        )}



          {/* Título/tipo e botões extras ficam ocultos durante a reprodução. */}
        {type === "series" && (
          <details
            className={`absolute bottom-4 right-4 z-30 max-h-[62dvh] w-[min(26rem,calc(100dvw-2rem))] overflow-y-auto rounded-lg border border-white/10 bg-player/82 backdrop-blur transition-opacity duration-300 ${
              showControls ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
          >
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
