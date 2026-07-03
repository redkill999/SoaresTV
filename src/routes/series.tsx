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
import { api, type LiveCategory, type Series, xtreamCredsFromUrl } from "@/lib/xtream";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { useProgressive } from "@/hooks/use-progressive";
import { filterBySearch, getSorted } from "@/lib/search-index";
import { loadPersisted, withPersist } from "@/lib/query-persist";
import { Clapperboard } from "lucide-react";

export const Route = createFileRoute("/series")({
  head: () => ({ meta: [{ title: "Séries — SoaresTV" }] }),
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
      queryKey: ["series-cats", acct],
      queryFn: withPersist(`series-cats:${acct}`, () => api<LiveCategory[]>(creds!, "get_series_categories")),
    });
    void context.queryClient.prefetchQuery({
      queryKey: ["series-list", acct, "all"],
      queryFn: withPersist(`series-list:${acct}:all`, () => api<Series[]>(creds!, "get_series")),
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
  useEffect(() => {
    const saved = store.getCreds();
    if (saved) { setCreds(saved); return; }
    // Sem creds salvas: recuperar só localmente (não persistir setCreds),
    // para nunca trocar a lista do usuário silenciosamente quando expirar.
    const firstList = store.getM3U()[0];
    const recovered = firstList ? xtreamCredsFromUrl(firstList.url, firstList.username, firstList.password) : null;
    if (recovered) setCreds(recovered);
  }, []);


  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const catsCacheKey = `series-cats:${acct}`;
  const listCacheKey = `series-list:${acct}:all`;
  const catsPersisted = useMemo(() => (acct ? loadPersisted<LiveCategory[]>(catsCacheKey) : null), [catsCacheKey, acct]);
  const listPersisted = useMemo(() => (acct ? loadPersisted<Series[]>(listCacheKey) : null), [listCacheKey, acct]);
  const catsQ = useQuery({
    queryKey: ["series-cats", acct],
    enabled: !!creds,
    queryFn: withPersist(catsCacheKey, () => api<LiveCategory[]>(creds!, "get_series_categories")),
    initialData: catsPersisted?.data,
    initialDataUpdatedAt: catsPersisted?.updatedAt,
    staleTime: 10 * 60_000,
  });
  const listQ = useQuery({
    queryKey: ["series-list", acct, "all"],
    enabled: !!creds,
    queryFn: withPersist(listCacheKey, () => api<Series[]>(creds!, "get_series")),
    initialData: listPersisted?.data,
    initialDataUpdatedAt: listPersisted?.updatedAt,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  // Fallback per-category (painéis grandes falham no "all" no APK TV).
  const perCatEnabled = !!creds && cat !== "all" && cat !== "favorites" && cat !== "recent";
  const perCatKey = `series-list:${acct}:cat:${cat}`;
  const perCatPersisted = useMemo(
    () => (perCatEnabled ? loadPersisted<Series[]>(perCatKey) : null),
    [perCatEnabled, perCatKey],
  );
  const perCatQ = useQuery({
    queryKey: ["series-list", acct, "cat", cat],
    enabled: perCatEnabled,
    queryFn: withPersist(perCatKey, () => api<Series[]>(creds!, "get_series", { category_id: cat })),
    initialData: perCatPersisted?.data,
    initialDataUpdatedAt: perCatPersisted?.updatedAt,
    staleTime: 10 * 60_000,
  });

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

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of listQ.data ?? []) {
      const k = String(x.category_id ?? "");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [listQ.data]);

  const sidebarCats = useMemo(
    () => (catsQ.data ?? []).map((c) => ({ id: c.category_id, name: c.category_name, count: counts.get(c.category_id) ?? 0 })),
    [catsQ.data, counts],
  );

  const parental = store.getParental();
  const lockedCats = useMemo(
    () => new Set(parental.lockedCategories.map(String)),
    [parental.lockedCategories],
  );
  const parentalActive = !!parental.pin && lockedCats.size > 0;
  const needGate = cat !== "all" && cat !== "favorites" && cat !== "recent" && !!parental.pin && parental.lockedCategories.includes(cat);
  const handleCatChange = useCallback((v: string) => { setCat(v); setUnlocked(false); }, []);

  const filtered = useMemo(() => {
    const source: Series[] =
      perCatEnabled && perCatQ.data ? perCatQ.data : (listQ.data ?? []);
    let list: Series[] = source;
    if (deferredSearch) list = filterBySearch(list, (x) => x.name, deferredSearch);
    if (cat === "favorites") list = list.filter((s) => favIds.has(String(s.series_id)));
    else if (cat === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list.filter((s) => order.has(String(s.series_id))).sort((a, b) => order.get(String(a.series_id))! - order.get(String(b.series_id))!);
    } else if (cat !== "all" && !perCatQ.data) {
      list = list.filter((s) => String(s.category_id) === cat);
    }
    if (parentalActive && (cat === "all" || cat === "favorites" || cat === "recent")) {
      list = list.filter((s) => !lockedCats.has(String(s.category_id)));
    }
    if (sort === "az" || sort === "za") list = getSorted(list, (x) => x.name, sort);
    return list;
  }, [listQ.data, perCatQ.data, perCatEnabled, deferredSearch, sort, cat, favIds, recentIds, parentalActive, lockedCats]);

  return (
    <PremiumChrome>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-white">
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
          totalCount={listQ.data?.length ?? 0}
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
          {!creds || (listQ.isLoading && !listQ.data && !perCatQ.data) || (perCatEnabled && perCatQ.isLoading && !perCatQ.data) ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-sm bg-white/[0.05] animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-white/60">
              <Clapperboard className="size-10 mx-auto mb-3 opacity-40" />
              {cat === "all" && !listQ.data
                ? "Lista muito grande para carregar tudo. Selecione uma categoria à esquerda."
                : "Nenhuma série encontrada."}
            </div>
          ) : (
            <SeriesGrid filtered={filtered} progressMap={progressMap} />
          )}
        </div>
      </div>
      </div>
    </PremiumChrome>
  );
}

function SeriesGrid({ filtered, progressMap }: { filtered: Series[]; progressMap: Map<string, number> }) {
  const { visible, sentinelRef, hasMore } = useProgressive(filtered);
  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {visible.map((s) => {
          const id = String(s.series_id);
          return (
            <XciptvTile
              key={s.series_id}
              type="series"
              id={id}
              name={s.name}
              image={s.cover}
              progress={progressMap.get(id)}
            />
          );
        })}
      </div>
      {hasMore && <div ref={sentinelRef} className="h-8" />}
    </>
  );
}
