import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Search, Heart, ListVideo, Trash2 } from "lucide-react";
import { loadM3U, type M3UEntry, xtreamCredsFromUrl } from "@/lib/xtream";
import { store, type M3UPlaylist } from "@/lib/storage";
import { m3uCache } from "@/lib/m3u-cache";
import { toast } from "sonner";

const MAX_RENDER = 500;

export const Route = createFileRoute("/playlist")({
  validateSearch: (s: Record<string, unknown>) => ({
    url: typeof s.url === "string" ? s.url : "",
    name: typeof s.name === "string" ? s.name : "",
  }),
  head: () => ({ meta: [{ title: "Lista M3U — SoaresTV" }] }),
  component: PlaylistPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div>
        <h2 className="text-lg font-semibold mb-2">Erro ao carregar a lista</h2>
        <p className="text-sm text-muted-foreground mb-4 max-w-md">{error.message}</p>
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
  const { url: urlParam, name } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<M3UEntry | null>(null);
  const [group, setGroup] = useState<string>("all");
  const [mounted, setMounted] = useState(false);

  // Prefer in-memory cache (just loaded from login flow). Fall back to URL
  // param if user landed here directly (deep link / reload).
  const cached = mounted ? m3uCache.get() : null;
  const [savedLists, setSavedLists] = useState<M3UPlaylist[]>([]);
  useEffect(() => {
    setMounted(true);
    setSavedLists(store.getM3U());
  }, []);
  const savedList = savedLists.find((l) => l.url === (urlParam || cached?.url)) ?? savedLists[0];
  const fallbackUrl = urlParam || cached?.url || savedList?.url || "";
  const displayName = name || cached?.name || savedList?.name || "Lista M3U";

  useEffect(() => {
    if (!fallbackUrl) return;
    const xtreamCreds = xtreamCredsFromUrl(fallbackUrl, savedList?.username, savedList?.password);
    if (xtreamCreds && !store.getCreds()) store.setCreds(xtreamCreds);
  }, [fallbackUrl, savedList?.username, savedList?.password]);

  const q = useQuery({
    queryKey: ["m3u", fallbackUrl, savedList?.username, savedList?.password],
    enabled: !cached && !!fallbackUrl,
    queryFn: async () => {
      const entries = await loadM3U(fallbackUrl, savedList?.username, savedList?.password);
      m3uCache.set(fallbackUrl, displayName, entries);
      return entries;
    },
    retry: 1,
    staleTime: Infinity,
  });

  const entries: M3UEntry[] = cached?.entries ?? q.data ?? [];

  const groups = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((e) => e.group && set.add(e.group));
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries;
    if (group !== "all") list = list.filter((e) => e.group === group);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(s));
    }
    return list;
  }, [entries, group, search]);

  const visible = filtered.slice(0, MAX_RENDER);

  if (!cached && !fallbackUrl) {
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

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/home" })}>
          <ArrowLeft className="size-4" /> Voltar
        </Button>
        <div className="size-9 rounded-xl bg-brand-gradient shadow-glow" />
        <div className="flex-1 min-w-0">
          <h1 className="font-bold flex items-center gap-2 truncate">
            <ListVideo className="size-4 shrink-0" /> {displayName}
          </h1>
          <p className="text-xs text-muted-foreground">
            {q.isLoading
              ? "Carregando…"
              : `${entries.length.toLocaleString("pt-BR")} canais` +
                (filtered.length !== entries.length
                  ? ` • ${filtered.length.toLocaleString("pt-BR")} filtrados`
                  : "")}
          </p>
        </div>
        <PlaylistSwitcher
          currentUrl={fallbackUrl}
          onPick={(p) => {
            m3uCache.clear();
            setActive(null);
            navigate({ to: "/playlist", search: { url: p.url, name: p.name } });
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            m3uCache.clear();
            qc.invalidateQueries({ queryKey: ["m3u"] });
            setActive(null);
            toast.success("Cache da lista limpo");
          }}
        >
          <Trash2 className="size-4" /> Limpar cache
        </Button>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-4">
        <div>
          {active ? (
            <>
              <VideoPlayer
                src={active.url}
                poster={active.logo}
                kind={/\/movie\/|\/series\//i.test(active.url) || /^Filmes\s*\|/i.test(active.group ?? "") ? "vod" : "live"}
              />
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
            {groups.slice(0, 200).map((g) => (
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
            {visible.map((e) => (
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
            {filtered.length > MAX_RENDER && (
              <p className="text-[11px] text-muted-foreground text-center py-3">
                Mostrando {MAX_RENDER.toLocaleString("pt-BR")} de{" "}
                {filtered.length.toLocaleString("pt-BR")}. Use a busca para refinar.
              </p>
            )}
            {q.isLoading && (
              <p className="text-xs text-muted-foreground text-center py-4">Carregando…</p>
            )}
            {q.isError && (
              <p className="text-xs text-destructive text-center py-4 px-2 break-words">
                {q.error instanceof Error ? q.error.message : "Falha ao carregar a lista"}
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function PlaylistSwitcher({
  currentUrl,
  onPick,
}: {
  currentUrl: string;
  onPick: (p: { url: string; name: string }) => void;
}) {
  const [lists, setLists] = useState<M3UPlaylist[]>([]);
  useEffect(() => setLists(store.getM3U()), []);
  if (lists.length <= 1) return null;
  return (
    <select
      value={currentUrl}
      onChange={(e) => {
        const found = lists.find((l) => l.url === e.target.value);
        if (found) onPick({ url: found.url, name: found.name });
      }}
      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs max-w-[200px]"
    >
      {lists.map((l) => (
        <option key={l.url} value={l.url} className="bg-background">
          {l.name}
        </option>
      ))}
    </select>
  );
}
