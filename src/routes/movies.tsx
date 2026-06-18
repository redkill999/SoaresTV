import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { MediaGrid } from "@/components/MediaGrid";
import { CatChip, SectionTabs, SortMenu, type SortKey, type TabKey } from "@/components/SectionTabs";
import { store } from "@/lib/storage";
import { api, type LiveCategory, type VodStream } from "@/lib/xtream";
import { Film } from "lucide-react";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { emptyHint, emptyTitle } from "./live";

export const Route = createFileRoute("/movies")({
  head: () => ({ meta: [{ title: "Filmes — SoaresTV" }] }),
  component: MoviesPage,
});

function MoviesPage() {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [tab, setTab] = useState<TabKey>("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const creds = mounted ? store.getCreds() : null;

  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const catsQ = useQuery({
    queryKey: ["vod-cats", acct],
    enabled: !!creds,
    queryFn: () => api<LiveCategory[]>(creds!, "get_vod_categories"),
  });
  const listQ = useQuery({
    queryKey: ["vod-list", acct, cat],
    enabled: !!creds,
    queryFn: () =>
      api<VodStream[]>(creds!, "get_vod_streams", cat !== "all" ? { category_id: cat } : undefined),
  });

  const favs = useFavorites();
  const history = useHistory();
  const favIds = useMemo(
    () => new Set(favs.filter((f) => f.type === "movie").map((f) => f.id)),
    [favs],
  );
  const recentIds = useMemo(
    () => history.filter((h) => h.type === "movie").map((h) => h.id),
    [history],
  );

  const filtered = useMemo(() => {
    let list = listQ.data ?? [];
    const idOf = (m: VodStream) => `${m.stream_id}.${m.container_extension || "mp4"}`;
    if (tab === "favorites") list = list.filter((m) => favIds.has(idOf(m)));
    if (tab === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list
        .filter((m) => order.has(idOf(m)))
        .sort((a, b) => order.get(idOf(a))! - order.get(idOf(b))!);
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((x) => x.name.toLowerCase().includes(s));
    }
    if (sort === "az") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "za") list = [...list].sort((a, b) => b.name.localeCompare(a.name));
    return list;
  }, [listQ.data, search, sort, tab, favIds, recentIds]);

  return (
    <AppShell search={search} onSearch={setSearch}>
      <div className="mb-5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 mb-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight truncate">
              Filmes
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Catálogo sob demanda
            </p>
          </div>
          <div className="shrink-0">
            <SortMenu value={sort} onChange={setSort} />
          </div>
        </div>
        <SectionTabs
          value={tab}
          onChange={setTab}
          counts={{ favorites: favIds.size, recent: recentIds.length }}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-3 mb-5 -mx-1 px-1">
        <CatChip active={cat === "all"} onClick={() => setCat("all")}>
          Todas categorias
        </CatChip>
        {(catsQ.data ?? []).map((c) => (
          <CatChip key={c.category_id} active={cat === c.category_id} onClick={() => setCat(c.category_id)}>
            {c.category_name}
          </CatChip>
        ))}
      </div>

      <MediaGrid
        loading={listQ.isLoading}
        empty={!listQ.isLoading && filtered.length === 0}
        aspect="poster"
        emptyIcon={<Film className="size-7" />}
        emptyTitle={emptyTitle(tab, "filme")}
        emptyHint={emptyHint(tab, search)}
      >
        {filtered.map((m) => (
          <MediaCard
            key={m.stream_id}
            type="movie"
            id={`${m.stream_id}.${m.container_extension || "mp4"}`}
            name={m.name}
            image={m.stream_icon}
            badge={m.rating || undefined}
            aspect="poster"
          />
        ))}
      </MediaGrid>
    </AppShell>
  );
}
