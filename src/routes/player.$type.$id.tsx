import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Button } from "@/components/ui/button";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, streamUrl } from "@/lib/xtream";
import { isNativeAppSync } from "@/lib/platform";
import { ArrowLeft } from "lucide-react";

const VALID_TYPES = ["live", "movie", "series"] as const;
type PlayerType = (typeof VALID_TYPES)[number];
const isPlayerType = (t: string): t is PlayerType =>
  (VALID_TYPES as readonly string[]).includes(t);
const EMPTY_FALLBACK_SRCS: string[] = [];

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

function playableDirectSource(direct?: string): string | null {
  if (!direct || !/^https?:\/\//i.test(direct)) return null;
  try {
    const path = new URL(direct).pathname.toLowerCase();
    return /\.(m3u8|mp4|m4v|mov|webm|mkv|avi|ts)(\?|$)/i.test(path) ? direct : null;
  } catch {
    return null;
  }
}

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
  const [episodeFallbackSrcs, setEpisodeFallbackSrcs] = useState<string[]>([]);
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
      const canonical = streamUrl.episode(creds, ep.id, ep.container_extension || "mp4");
      const direct = playableDirectSource(ep.direct_source);
      // VOD que funcionava no preview usava `direct_source` quando o painel
      // fornece uma URL de arquivo real. Mantemos a canônica Xtream como
      // fallback, mas não deixamos ela atrasar/bloquear o caminho direto.
      setEpisodeUrl(direct ?? canonical);
      setEpisodeFallbackSrcs(Array.from(new Set([direct ? canonical : null].filter(Boolean) as string[])));
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

  const url = useMemo(() => {
    if (!creds) return "";
    if (type === "live") return streamUrl.live(creds, id);
    if (type === "movie") {
      // id may include ".ext"
      const [sid, ext] = id.split(".");
      const movieId = movieQ.data?.movie_data?.stream_id ?? sid;
      const movieExt = movieQ.data?.movie_data?.container_extension || ext || "mp4";
      const canonical = streamUrl.movie(creds, movieId, movieExt);
      const direct = playableDirectSource(movieQ.data?.movie_data?.direct_source);
      return direct ?? canonical;
    }
    if (type === "series") return episodeUrl ?? "";
    return "";
  }, [creds, type, id, episodeUrl, movieQ.data]);

  const movieFallbackSrcs = useMemo(() => {
    if (!creds || type !== "movie") return [];
    const [sid, ext] = id.split(".");
    const movieId = movieQ.data?.movie_data?.stream_id ?? sid;
    const movieExt = movieQ.data?.movie_data?.container_extension || ext || "mp4";
    const canonical = streamUrl.movie(creds, movieId, movieExt);
    const direct = playableDirectSource(movieQ.data?.movie_data?.direct_source);
    return Array.from(new Set([direct ? canonical : null].filter(Boolean) as string[]));
  }, [creds, type, id, movieQ.data]);

  const vodFallbackSrcs = type === "movie" ? movieFallbackSrcs : type === "series" ? episodeFallbackSrcs : EMPTY_FALLBACK_SRCS;

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

  // Fase 7 — Fullscreen desktop padrão (F11 já é nativo do browser; aqui
  // adicionamos tecla "F" e double-click no container, como Tivimate/Plex).
  const stageRef = useRef<HTMLDivElement | null>(null);
  const toggleFullscreen = useCallback(() => {
    const d = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const el = stageRef.current as (HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    }) | null;
    if (!el) return;
    const inFs = !!(document.fullscreenElement || d.webkitFullscreenElement);
    try {
      if (inFs) {
        if (typeof document.exitFullscreen === "function") void document.exitFullscreen();
        else if (typeof d.webkitExitFullscreen === "function") void d.webkitExitFullscreen();
      } else {
        if (typeof el.requestFullscreen === "function") void el.requestFullscreen();
        else if (typeof el.webkitRequestFullscreen === "function") void el.webkitRequestFullscreen();
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignora se o usuário está digitando em algum input/textarea.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen]);

  return (
    <AppShell immersive>
      <div
        ref={stageRef}
        className="relative h-dvh w-dvw overflow-hidden bg-player text-player-foreground"
        onMouseMove={revealControls}
        onMouseEnter={revealControls}
        onTouchStart={revealControls}
        onDoubleClick={toggleFullscreen}
      >
        <div className="absolute inset-0 bg-player">
          {url ? (
            <VideoPlayer
              src={url}
              kind={type === "live" ? "live" : "vod"}
              fallbackSrcs={vodFallbackSrcs}
              initialPosition={initialPosition}
              onProgress={handleProgress}
            />
          ) : (
            <PlayerLoadingOrError type={type ?? "movie"} onBack={closePlayer} />
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

          {/* Título/tipo e botões extras ficam ocultos durante a reprodução.
              Episódios segue o mesmo auto-hide do botão Voltar (showControls):
              aparece com mouse/touch/D-Pad e some após inatividade. */}
        {type === "series" && (
          <div
            className={`absolute bottom-4 right-4 z-30 transition-opacity duration-300 ${
              showControls ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
            aria-hidden={!showControls}
          >
          <details className="max-h-[62dvh] w-[min(26rem,calc(100dvw-2rem))] overflow-y-auto rounded-lg border border-white/10 bg-player/82 backdrop-blur">
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
          </div>
        )}
        {null}

      </div>
    </AppShell>
  );
}

// FIX D6 (audit IPTV): antes mostrava "Carregando…" indefinidamente quando
// playlist vazia ou stream URL não resolveu. Agora após 12s exibe mensagem
// de erro com botão "Voltar" para o usuário não ficar preso.
function PlayerLoadingOrError({
  type,
  onBack,
}: {
  type: PlayerType;
  onBack: () => void;
}) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 12_000);
    return () => clearTimeout(t);
  }, []);
  if (!timedOut) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-player text-muted-foreground">
        {type === "series" ? "Carregando episódio…" : "Carregando…"}
      </div>
    );
  }
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-player px-6 text-center text-muted-foreground">
      <div className="text-base font-semibold text-foreground">
        Não foi possível carregar este conteúdo.
      </div>
      <div className="text-sm">
        Verifique sua conexão ou tente outro item.
      </div>
      <Button variant="outline" onClick={onBack} className="mt-2">
        <ArrowLeft className="size-4 mr-1" /> Voltar
      </Button>
    </div>
  );
}

