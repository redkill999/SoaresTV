import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Button } from "@/components/ui/button";
import { store, type XtreamCreds, type FavItem } from "@/lib/storage";
import { api, streamUrl, getShortEpg, type EpgListing } from "@/lib/xtream";
import { useIsFavorite } from "@/hooks/use-favorites";
import { ArrowLeft, Heart, Clock } from "lucide-react";

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

  const favType: FavItem["type"] = type ?? "movie";
  const fav = useIsFavorite(favType, id) && !!type;


  return (
    <AppShell>
      <button
        onClick={() => {
          if (typeof window !== "undefined" && window.history.length > 1) {
            window.history.back();
          } else {
            navigate({ to: "/home" });
          }
        }}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="size-4" /> Voltar
      </button>


      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div>
          {url ? (
            <VideoPlayer src={url} kind={type === "live" ? "live" : "vod"} />
          ) : (
            <div className="aspect-video bg-card rounded-xl flex items-center justify-center text-muted-foreground">
              {type === "series" ? "Selecione um episódio" : "Carregando…"}
            </div>
          )}
          <div className="flex items-start justify-between gap-4 mt-4">
            <div>
              <h1 className="text-xl font-bold">{activeTitle || name || "Reproduzindo"}</h1>
              <p className="text-xs text-muted-foreground uppercase tracking-widest">{type}</p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                if (!type) return;
                store.toggleFav({ type, id, name: activeTitle || name });
              }}
            >
              <Heart className={`size-4 ${fav ? "fill-primary text-primary" : ""}`} />
              Favorito
            </Button>

          </div>
        </div>

        {type === "series" && (
          <aside className="glass rounded-xl p-4 max-h-[80vh] overflow-y-auto">
            <h2 className="font-semibold mb-3">Episódios</h2>
            {seriesQ.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {seriesQ.data?.episodes &&
              Object.entries(seriesQ.data.episodes).map(([season, eps]) => (
                <div key={season} className="mb-4">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                    Temporada {season}
                  </div>
                  <div className="space-y-1">
                    {eps.map((ep) => (
                      <button
                        key={ep.id}
                        onClick={() => {
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
                          setActiveTitle(`${name} — ${ep.title}`);
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-white/5 transition"
                      >
                        <span className="text-muted-foreground mr-2">E{ep.episode_num}</span>
                        {ep.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </aside>
        )}
        {type === "live" && (
          <aside className="glass rounded-xl p-4 max-h-[80vh] overflow-y-auto">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Clock className="size-4" /> Programação
            </h2>
            {epgQ.isLoading && <p className="text-sm text-muted-foreground">Carregando EPG…</p>}
            {!epgQ.isLoading && !epgQ.data?.length && (
              <p className="text-sm text-muted-foreground">Sem EPG disponível.</p>
            )}
            <div className="space-y-2">
              {(epgQ.data ?? []).map((p: EpgListing, i: number) => {
                const start = new Date(Number(p.start_timestamp) * 1000);
                const stop = new Date(Number(p.stop_timestamp) * 1000);
                const now = Date.now();
                const live = now >= start.getTime() && now < stop.getTime();
                return (
                  <div
                    key={p.id}
                    className={`p-3 rounded-lg border ${
                      live
                        ? "bg-brand-gradient/20 border-primary/50"
                        : "bg-white/5 border-white/5"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {live ? "Agora" : i === 0 ? "Anterior" : "A seguir"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                        {stop.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="text-sm font-medium mt-1">{p.title}</div>
                    {p.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {p.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </AppShell>
  );
}
