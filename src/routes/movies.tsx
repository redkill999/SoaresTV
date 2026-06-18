import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { VirtualMediaGrid } from "@/components/VirtualMediaGrid";
import { CatChip, CatChipsSkeleton, SectionTabs, SortMenu, type SortKey, type TabKey } from "@/components/SectionTabs";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, type LiveCategory, type VodStream } from "@/lib/xtream";
import { ArrowLeft, Film } from "lucide-react";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { emptyHint, emptyTitle } from "./live";
import { useTranslation } from "react-i18next";
import { loadPersisted, withPersist } from "@/lib/query-persist";

export const Route = createFileRoute("/movies")({
  head: () => ({ meta: [{ title: "Filmes — SoaresTV" }] }),
  // Prefetch ao passar o mouse / focar no link do menu (defaultPreload: "intent").
  loader: ({ context }) => {
    const creds = store.getCreds();
    if (!creds) return;
    const acct = `${creds.server}|${creds.username}`;
    void context.queryClient.prefetchQuery({
      queryKey: ["vod-cats", acct],
      queryFn: withPersist(`vod-cats:${acct}`, () => api<LiveCategory[]>(creds, "get_vod_categories")),
    });
    void context.queryClient.prefetchQuery({
      queryKey: ["vod-list", acct, "all"],
      queryFn: withPersist(`vod-list:${acct}:all`, () => api<VodStream[]>(creds, "get_vod_streams")),
    });
  },
  component: MoviesPage,
});

function MoviesPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [tab, setTab] = useState<TabKey>("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  useEffect(() => setCreds(store.getCreds()), []);

  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const catsCacheKey = `vod-cats:${acct}`;
  const listCacheKey = `vod-list:${acct}:${cat}`;
  const catsPersisted = useMemo(
    () => (acct ? loadPersisted<LiveCategory[]>(catsCacheKey) : null),
    [catsCacheKey, acct],
  );
  const listPersisted = useMemo(
    () => (acct ? loadPersisted<VodStream[]>(listCacheKey) : null),
    [listCacheKey, acct],
  );
  const catsQ = useQuery({
    queryKey: ["vod-cats", acct],
    enabled: !!creds,
    queryFn: withPersist(catsCacheKey, () => api<LiveCategory[]>(creds!, "get_vod_categories")),
    initialData: catsPersisted?.data,
    initialDataUpdatedAt: catsPersisted?.updatedAt,
    staleTime: 10 * 60_000,
  });
  const listQ = useQuery({
    queryKey: ["vod-list", acct, cat],
    enabled: !!creds,
    queryFn: withPersist(listCacheKey, () =>
      api<VodStream[]>(creds!, "get_vod_streams", cat !== "all" ? { category_id: cat } : undefined),
    ),
    initialData: listPersisted?.data,
    initialDataUpdatedAt: listPersisted?.updatedAt,
    staleTime: 10 * 60_000,
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
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-3 mb-4">
          <Link
            to="/home"
            aria-label={t("common.back")}
            className="shrink-0 inline-flex items-center justify-center size-10 rounded-full border border-border bg-card/50 hover:bg-card transition-colors"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight truncate">
              {t("pages.movies.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("pages.movies.subtitle")}
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
          {t("pages.allCategories")}
        </CatChip>
        {!creds || (catsQ.isLoading && !catsQ.data) ? (
          <CatChipsSkeleton />
        ) : (
          (catsQ.data ?? []).map((c) => (
            <CatChip key={c.category_id} active={cat === c.category_id} onClick={() => setCat(c.category_id)}>
              {c.category_name}
            </CatChip>
          ))
        )}
      </div>

      <VirtualMediaGrid
        items={filtered}
        loading={!creds || (listQ.isLoading && filtered.length === 0)}
        empty={!!creds && !listQ.isLoading && filtered.length === 0}
        aspect="poster"
        emptyIcon={<Film className="size-7" />}
        emptyTitle={emptyTitle(tab, "movie")}
        emptyHint={emptyHint(tab, search)}
        getKey={(m) => m.stream_id}
        renderItem={(m) => (
          <MediaCard
            type="movie"
            id={`${m.stream_id}.${m.container_extension || "mp4"}`}
            name={m.name}
            image={m.stream_icon}
            badge={m.rating || undefined}
            aspect="poster"
          />
        )}
      />
    </AppShell>
  );
}
