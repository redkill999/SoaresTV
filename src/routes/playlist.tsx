import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Search, Heart, ListVideo } from "lucide-react";
import { loadM3U, type M3UEntry } from "@/lib/xtream";
import { store } from "@/lib/storage";

export const Route = createFileRoute("/playlist")({
  validateSearch: (s: Record<string, unknown>) => ({
    url: typeof s.url === "string" ? s.url : "",
    name: typeof s.name === "string" ? s.name : "Lista M3U",
  }),
  head: () => ({ meta: [{ title: "Lista M3U — SoaresTV" }] }),
  component: PlaylistPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div>
        <h2 className="text-lg font-semibold mb-2">Erro ao carregar a lista</h2>
        <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
        <a href="/" className="text-primary underline">Voltar para o login</a>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <a href="/" className="text-primary underline">Voltar para o login</a>
    </div>
  ),
});

function PlaylistPage() {
  const { url, name } = Route.useSearch();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<M3UEntry | null>(null);
  const [group, setGroup] = useState<string>("all");

  const q = useQuery({
    queryKey: ["m3u", url],
    enabled: !!url,
    queryFn: () => loadM3U(url),
    retry: 1,
  });

  if (!url) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <div>
          <h2 className="text-lg font-semibold mb-2">Nenhuma lista selecionada</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Volte para o login e carregue uma lista M3U.
          </p>
          <Button onClick={() => navigate({ to: "/" })}>Voltar</Button>
        </div>
      </div>
    );
  }

  const filtered = useMemo(() => {
    let list = q.data ?? [];
    if (group !== "all") list = list.filter((e) => e.group === group);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(s));
    }
    return list;
  }, [q.data, group, search]);

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="flex items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })}>
          <ArrowLeft className="size-4" /> Voltar
        </Button>
        <div className="size-9 rounded-xl bg-brand-gradient shadow-glow" />
        <div>
          <h1 className="font-bold flex items-center gap-2">
            <ListVideo className="size-4" /> {name}
          </h1>
          <p className="text-xs text-muted-foreground">
            {q.data ? `${q.data.length} canais` : "Carregando…"}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <div>
          {active ? (
            <>
              <VideoPlayer src={active.url} poster={active.logo} />
              <div className="mt-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{active.name}</div>
                  {active.group && (
                    <div className="text-xs text-muted-foreground">{active.group}</div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    store.toggleFav({
                      type: "live",
                      id: active.id,
                      name: active.name,
                      logo: active.logo,
                    })
                  }
                >
                  <Heart className="size-4" /> Favoritar
                </Button>
              </div>
            </>
          ) : (
            <div className="aspect-video bg-card rounded-xl flex items-center justify-center text-muted-foreground">
              Selecione um canal
            </div>
          )}
        </div>

        <aside className="glass rounded-xl p-3 flex flex-col max-h-[80vh]">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar canal…"
              className="pl-9 bg-white/5 border-white/10"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2">
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                className={`px-3 py-1 rounded-full text-[11px] whitespace-nowrap border ${
                  group === g
                    ? "bg-brand-gradient text-primary-foreground border-transparent"
                    : "border-white/10 text-muted-foreground"
                }`}
              >
                {g === "all" ? "Todos" : g}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {filtered.map((e) => (
              <button
                key={e.id}
                onClick={() => setActive(e)}
                className={`w-full flex items-center gap-2 p-2 rounded-lg text-left text-sm hover:bg-white/5 transition ${
                  active?.id === e.id ? "bg-white/10" : ""
                }`}
              >
                {e.logo ? (
                  <img
                    src={e.logo}
                    alt=""
                    className="size-8 rounded object-contain bg-black/30"
                    loading="lazy"
                    onError={(ev) => (ev.currentTarget.style.opacity = "0.2")}
                  />
                ) : (
                  <div className="size-8 rounded bg-brand-gradient/30" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate">{e.name}</div>
                  {e.group && (
                    <div className="text-[10px] text-muted-foreground truncate">{e.group}</div>
                  )}
                </div>
              </button>
            ))}
            {q.isLoading && (
              <p className="text-xs text-muted-foreground text-center py-4">Carregando…</p>
            )}
            {q.isError && (
              <p className="text-xs text-destructive text-center py-4">
                Falha ao carregar a lista
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
