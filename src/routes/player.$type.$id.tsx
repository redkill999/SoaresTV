import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Button } from "@/components/ui/button";
import { store } from "@/lib/storage";
import { api, streamUrl } from "@/lib/xtream";
import { ArrowLeft, Heart } from "lucide-react";

export const Route = createFileRoute("/player/$type/$id")({
  validateSearch: (s: Record<string, unknown>) => ({ name: (s.name as string) ?? "" }),
  head: ({ params }) => ({ meta: [{ title: `Player — ${params.id}` }] }),
  component: PlayerPage,
});

type SeriesInfo = {
  seasons?: Array<{ season_number: number; name?: string }>;
  episodes?: Record<string, Array<{ id: string; title: string; container_extension: string; episode_num: number }>>;
};

function PlayerPage() {
  const { type, id } = Route.useParams();
  const { name } = Route.useSearch();
  const navigate = useNavigate();
  const creds = typeof window !== "undefined" ? store.getCreds() : null;
  const [episodeUrl, setEpisodeUrl] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState(name);

  useEffect(() => {
    if (!creds) navigate({ to: "/" });
  }, [creds, navigate]);

  const seriesQ = useQuery({
    queryKey: ["series-info", id],
    enabled: !!creds && type === "series",
    queryFn: () => api<SeriesInfo>(creds!, "get_series_info", { series_id: id }),
  });

  const url = useMemo(() => {
    if (!creds) return "";
    if (type === "live") return streamUrl.live(creds, id);
    if (type === "movie") {
      // id may include ".ext"
      const [sid, ext] = id.split(".");
      return streamUrl.movie(creds, sid, ext || "mp4");
    }
    if (type === "series") return episodeUrl ?? "";
    return "";
  }, [creds, type, id, episodeUrl]);

  useEffect(() => {
    if (!url || !creds) return;
    store.pushHistory({ type: type as never, id, name: activeTitle || id, at: Date.now() });
  }, [url, type, id, activeTitle, creds]);

  const fav = creds ? store.isFav(type as never, id) : false;

  return (
    <AppShell>
      <button
        onClick={() => history.back()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="size-4" /> Voltar
      </button>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div>
          {url ? (
            <VideoPlayer src={url} />
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
              onClick={() => store.toggleFav({ type: type as never, id, name: activeTitle || name })}
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
                          setEpisodeUrl(streamUrl.episode(creds, ep.id, ep.container_extension));
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
      </div>
    </AppShell>
  );
}
