import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PremiumChrome } from "@/components/PremiumChrome";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ParentalGate } from "@/components/ParentalGate";
import { XciptvHeader } from "@/components/xciptv/XciptvHeader";
import { XciptvCategoryList } from "@/components/xciptv/XciptvCategoryList";
import { XciptvTile } from "@/components/xciptv/XciptvTile";
import { MediaCard } from "@/components/MediaCard";
import { store, type XtreamCreds, type HistItem } from "@/lib/storage";
import { apiList, type LiveCategory, type Series, xtreamCredsFromUrl } from "@/lib/xtream";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { useProgressive } from "@/hooks/use-progressive";
import { filterBySearch, getSorted } from "@/lib/search-index";
import { loadPersisted, withPersist } from "@/lib/query-persist";
import { Clapperboard } from "lucide-react";

export const Route = createFileRoute("/series")({
  head: () => ({
    meta: [
      { title: "Séries — SoaresTV" },
      { name: "description", content: "Assista séries completas na SoaresTV: temporadas e episódios organizados por gênero com histórico e continue de onde parou." },
      { property: "og:title", content: "Séries — SoaresTV" },
      { property: "og:description", content: "Assista séries completas na SoaresTV: temporadas e episódios organizados por gênero com histórico e continue de onde parou." },
      { property: "og:url", content: "https://tv-magica-brasa-soarestv.lovable.app/series" },
    ],
    links: [{ rel: "canonical", href: "https://tv-magica-brasa-soarestv.lovable.app/series" }],
  }),
  loader: ({ context }) => {
    let creds = store.getCreds();
    if (!creds) {
      const firstList = store.getM3U()[0];
      const recovered = firstList ? xtreamCredsFromUrl(firstList.url, firstList.username, firstList.password) : null;
      if (recovered) creds = recovered;
    }
    if (!creds) return;
    const acct = `${creds.server}|${creds.username}`;
    void context.queryClient.prefetchQuery({
      queryKey: ["series-cats", "v3", acct],
      queryFn: withPersist(
        `series-cats:v3:${acct}`,
        () => apiList<LiveCategory>(creds!, "get_series_categories"),
        { shouldPersist: (d) => Array.isArray(d) && d.length > 0 },
      ),
    });
  },
  component: SeriesPage,
});

function SeriesPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<"az" | "za" | "default">("default");
  const [unlocked, setUnlocked] = useState(false);
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [loadedCounts, setLoadedCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const saved = store.getCreds();
    if (saved) { setCreds(saved); return; }
    const firstList = store.getM3U()[0];
    const recovered = firstList ? xtreamCredsFromUrl(firstList.url, firstList.username, firstList.password) : null;
    if (recovered) setCreds(recovered);
  }, []);

  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const catsCacheKey = `series-cats:v3:${acct}`;
  const nonEmptyArr = <T,>(v: T[] | undefined | null): v is T[] => Array.isArray(v) && v.length > 0;
  const catsPersisted = useMemo(() => (acct ? loadPersisted<LiveCategory[]>(catsCacheKey) : null), [catsCacheKey, acct]);
  const catsInitialData = nonEmptyArr(catsPersisted?.data) ? catsPersisted!.data : undefined;

  const catsQ = useQuery({
    queryKey: ["series-cats", "v3", acct],
    enabled: !!creds,
    queryFn: withPersist(
      catsCacheKey,
      () => apiList<LiveCategory>(creds!, "get_series_categories"),
      { shouldPersist: (d) => Array.isArray(d) && d.length > 0 },
    ),
    initialData: catsInitialData,
    initialDataUpdatedAt: catsInitialData ? catsPersisted?.updatedAt : undefined,
    staleTime: 10 * 60_000,
    refetchOnMount: catsInitialData ? false : "always",
    refetchOnReconnect: true,
    retry: 2,
  });

  useEffect(() => {
    if (cat === "all" && catsQ.data && catsQ.data.length > 0) {
      setCat(String(catsQ.data[0].category_id));
    }
  }, [cat, catsQ.data]);

  const perCatEnabled = !!creds && cat !== "all" && cat !== "favorites" && cat !== "recent";
  const perCatKey = `series-list:v3:${acct}:cat:${cat}`;
  const perCatPersisted = useMemo(
    () => (perCatEnabled ? loadPersisted<Series[]>(perCatKey) : null),
    [perCatEnabled, perCatKey],
  );
  const perCatInitial = nonEmptyArr(perCatPersisted?.data) ? perCatPersisted!.data : undefined;
  const perCatQ = useQuery({
    queryKey: ["series-list", "v3", acct, "cat", cat],
    enabled: perCatEnabled,
    queryFn: withPersist(
      perCatKey,
      () => apiList<Series>(creds!, "get_series", { category_id: cat }),
      { shouldPersist: (d) => Array.isArray(d) && d.length > 0 },
    ),
    initialData: perCatInitial,
    initialDataUpdatedAt: perCatInitial ? perCatPersisted?.updatedAt : undefined,
    staleTime: 10 * 60_000,
    refetchOnMount: perCatInitial ? false : "always",
    refetchOnReconnect: true,
    retry: 2,
  });

  useEffect(() => {
    if (perCatEnabled && Array.isArray(perCatQ.data)) {
      setLoadedCounts((prev) => (prev[cat] === perCatQ.data!.length ? prev : { ...prev, [cat]: perCatQ.data!.length }));
    }
  }, [cat, perCatEnabled, perCatQ.data]);

  const categoryItems: Series[] = Array.isArray(perCatQ.data) ? perCatQ.data : [];

  const favs = useFavorites();
  const history = useHistory();
  const favIds = useMemo(() => new Set(favs.filter((f) => f.type === "series").map((f) => f.id)), [favs]);
  const recentIds = useMemo(() => history.filter((h) => h.type === "series").map((h) => h.id), [history]);
  const progressMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of history) {
      if (h.type !== "series") continue;
      if (!h.position || !h.duration) continue;
      const p = h.position / h.duration;
      if (p > 0) m.set(h.id, p);
    }
    return m;
  }, [history]);
  const continueWatching = useMemo(() => {
    return (history as HistItem[])
      .filter((h) => h.type === "series" && h.position && h.duration)
      .filter((h) => {
        const p = (h.position ?? 0) / (h.duration ?? 1);
        return p >= 0.05 && p <= 0.95;
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 10);
  }, [history]);

  const sidebarCats = useMemo(
    () => (catsQ.data ?? []).map((c) => ({
      id: c.category_id,
      name: c.category_name,
      count: loadedCounts[c.category_id],
    })),
    [catsQ.data, loadedCounts],
  );

  const parental = store.getParental();
  const lockedCats = useMemo(() => new Set(parental.lockedCategories.map(String)), [parental.lockedCategories]);
  const parentalActive = !!parental.pin && lockedCats.size > 0;
  const needGate = cat !== "all" && cat !== "favorites" && cat !== "recent" && !!parental.pin && parental.lockedCategories.includes(cat);
  const handleCatChange = useCallback((v: string) => { setCat(v); setUnlocked(false); }, []);

  const filtered = useMemo(() => {
    let list: Series[] = perCatEnabled ? categoryItems : [];
    if (deferredSearch) list = filterBySearch(list, (x) => x.name, deferredSearch);
    if (cat === "favorites") list = list.filter((s) => favIds.has(String(s.series_id)));
    else if (cat === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list.filter((s) => order.has(String(s.series_id))).sort((a, b) => order.get(String(a.series_id))! - order.get(String(b.series_id))!);
    }
    if (parentalActive && (cat === "favorites" || cat === "recent")) {
      list = list.filter((s) => !lockedCats.has(String(s.category_id)));
    }
    if (sort === "az" || sort === "za") list = getSorted(list, (x) => x.name, sort);
    return list;
  }, [categoryItems, perCatEnabled, deferredSearch, sort, cat, favIds, recentIds, parentalActive, lockedCats]);

  const activeError = perCatEnabled ? perCatQ.error : null;
  const activeIsError = perCatEnabled ? perCatQ.isError : false;
  const retryActive = () => { if (perCatEnabled) void perCatQ.refetch(); };

  return (
    <PremiumChrome showBack={false}>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-white">
      <h1 className="sr-only">Catálogo de séries — SoaresTV</h1>
      <XciptvHeader sort={sort} onSort={setSort} search={search} onSearch={setSearch} title="SERIES" />
      {needGate && !unlocked ? (
        <div className="px-6"><ParentalGate categoryId={cat} onUnlock={() => setUnlocked(true)} /></div>
      ) : (
      <div className="flex-1 min-h-0 flex flex-col items-stretch sm:flex-row gap-3 px-3 sm:px-5 pb-3 overflow-hidden">
        <XciptvCategoryList
          categories={sidebarCats}
          value={cat}
          onChange={handleCatChange}
          loading={!creds || (catsQ.isLoading && !catsQ.data)}
          favCount={favIds.size}
          recentCount={recentIds.length}
          totalCount={undefined}
        />
        <div data-tv-scope className="flex-1 basis-0 min-w-0 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pr-1 [-webkit-overflow-scrolling:touch]">
          {continueWatching.length > 0 && (
            <section className="mb-4">
              <h2 className="text-xs uppercase tracking-widest text-white/70 mb-2 px-0.5">
                Continue assistindo
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {continueWatching.map((h) => (
                  <div key={h.id} className="shrink-0 w-28">
                    <MediaCard
                      type="series"
                      id={h.id}
                      name={h.name}
                      image={h.logo}
                      aspect="poster"
                      progress={(h.position ?? 0) / (h.duration ?? 1)}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
          {!creds || (perCatEnabled && perCatQ.isLoading && !perCatQ.data) ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-sm bg-white/[0.05] animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 && activeIsError ? (
            <div className="py-16 text-center text-white/70">
              <Clapperboard className="size-10 mx-auto mb-3 opacity-40" />
              <p className="mb-3">Falha ao carregar esta categoria.</p>
              {activeError instanceof Error && (
                <p className="text-xs text-white/40 mb-3">Detalhe: {activeError.message}</p>
              )}
              <button
                type="button"
                onClick={retryActive}
                className="rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
              >
                Tentar novamente
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-white/60">
              <Clapperboard className="size-10 mx-auto mb-3 opacity-40" />
              {cat === "all" ? "Selecione uma categoria à esquerda." : "Nenhuma série encontrada."}
            </div>
          ) : (
            <SeriesGrid filtered={filtered} progressMap={progressMap} />
          )}
        </div>
      </div>
      )}
      </div>
    </PremiumChrome>
  );
}

function SeriesGrid({ filtered, progressMap }: { filtered: Series[]; progressMap: Map<string, number> }) {
  const { visible, sentinelRef, hasMore } = useProgressive(filtered);
  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {visible.map((s, i) => {
          const id = String(s.series_id);
          return (
            <XciptvTile
              key={s.series_id}
              type="series"
              id={id}
              name={s.name}
              image={s.cover}
              progress={progressMap.get(id)}
              defaultFocus={i === 0}
            />
          );
        })}
      </div>
      {hasMore && <div ref={sentinelRef} className="h-8" />}
    </>
  );
}
