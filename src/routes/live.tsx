import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PremiumChrome } from "@/components/PremiumChrome";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ParentalGate } from "@/components/ParentalGate";
import { XciptvHeader } from "@/components/xciptv/XciptvHeader";
import { XciptvCategoryList } from "@/components/xciptv/XciptvCategoryList";
import { XciptvTile } from "@/components/xciptv/XciptvTile";
import { store, type XtreamCreds } from "@/lib/storage";
import { apiList, streamUrl, type LiveCategory, type LiveStream, xtreamCredsFromUrl } from "@/lib/xtream";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { useProgressive } from "@/hooks/use-progressive";
import { filterBySearch, getSorted } from "@/lib/search-index";
import { loadPersisted, withPersist } from "@/lib/query-persist";
import { Tv } from "lucide-react";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Ao Vivo — SoaresTV" }] }),
  loader: ({ context }) => {
    let creds = store.getCreds();
    if (!creds) {
      const firstList = store.getM3U()[0];
      const recovered = firstList ? xtreamCredsFromUrl(firstList.url, firstList.username, firstList.password) : null;
      if (recovered) creds = recovered;
    }
    if (!creds) return;
    const acct = `${creds.server}|${creds.username}`;
    // NUNCA prefetch da lista completa (get_live_streams) no loader — trava
    // WebView no APK. Só categorias, que são leves.
    void context.queryClient.prefetchQuery({
      queryKey: ["live-cats", "v3", acct],
      queryFn: withPersist(
        `live-cats:v3:${acct}`,
        () => apiList<LiveCategory>(creds!, "get_live_categories"),
        { shouldPersist: (d) => Array.isArray(d) && d.length > 0 },
      ),
    });
  },
  component: LivePage,
});

function LivePage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [cat, setCat] = useState<string>("all");
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
  const catsCacheKey = `live-cats:v3:${acct}`;
  const nonEmptyArr = <T,>(v: T[] | undefined | null): v is T[] => Array.isArray(v) && v.length > 0;
  const catsPersisted = useMemo(() => (acct ? loadPersisted<LiveCategory[]>(catsCacheKey) : null), [catsCacheKey, acct]);
  const catsInitialData = nonEmptyArr(catsPersisted?.data) ? catsPersisted!.data : undefined;

  const categoriesQ = useQuery({
    queryKey: ["live-cats", "v3", acct],
    enabled: !!creds,
    queryFn: withPersist(
      catsCacheKey,
      () => apiList<LiveCategory>(creds!, "get_live_categories"),
      { shouldPersist: (d) => Array.isArray(d) && d.length > 0 },
    ),
    initialData: catsInitialData,
    initialDataUpdatedAt: catsInitialData ? catsPersisted?.updatedAt : undefined,
    staleTime: 10 * 60_000,
    refetchOnMount: catsInitialData ? false : "always",
    refetchOnReconnect: true,
    retry: 2,
  });

  // Auto-seleciona a primeira categoria válida assim que carregar.
  useEffect(() => {
    if (cat === "all" && categoriesQ.data && categoriesQ.data.length > 0) {
      setCat(String(categoriesQ.data[0].category_id));
    }
  }, [cat, categoriesQ.data]);

  const perCatEnabled = !!creds && cat !== "all" && cat !== "favorites" && cat !== "recent";
  const perCatKey = `live-streams:v3:${acct}:cat:${cat}`;
  const perCatPersisted = useMemo(
    () => (perCatEnabled ? loadPersisted<LiveStream[]>(perCatKey) : null),
    [perCatEnabled, perCatKey],
  );
  const perCatInitial = nonEmptyArr(perCatPersisted?.data) ? perCatPersisted!.data : undefined;
  const perCatQ = useQuery({
    queryKey: ["live-streams", "v3", acct, "cat", cat],
    enabled: perCatEnabled,
    queryFn: withPersist(
      perCatKey,
      () => apiList<LiveStream>(creds!, "get_live_streams", { category_id: cat }),
      { shouldPersist: (d) => Array.isArray(d) && d.length > 0 },
    ),
    initialData: perCatInitial,
    initialDataUpdatedAt: perCatInitial ? perCatPersisted?.updatedAt : undefined,
    staleTime: 10 * 60_000,
    refetchOnMount: perCatInitial ? false : "always",
    refetchOnReconnect: true,
    retry: 2,
  });

  // Atualiza mapa de contagens conforme cada categoria é carregada.
  useEffect(() => {
    if (perCatEnabled && Array.isArray(perCatQ.data)) {
      setLoadedCounts((prev) => (prev[cat] === perCatQ.data!.length ? prev : { ...prev, [cat]: perCatQ.data!.length }));
    }
  }, [cat, perCatEnabled, perCatQ.data]);

  const categoryItems: LiveStream[] = Array.isArray(perCatQ.data) ? perCatQ.data : [];

  const favs = useFavorites();
  const history = useHistory();
  const favIds = useMemo(() => new Set(favs.filter((f) => f.type === "live").map((f) => f.id)), [favs]);
  const recentIds = useMemo(() => history.filter((h) => h.type === "live").map((h) => h.id), [history]);

  const sidebarCats = useMemo(
    () => (categoriesQ.data ?? []).map((c) => ({
      id: c.category_id,
      name: c.category_name,
      count: loadedCounts[c.category_id],
    })),
    [categoriesQ.data, loadedCounts],
  );

  const parental = store.getParental();
  const lockedCats = useMemo(() => new Set(parental.lockedCategories.map(String)), [parental.lockedCategories]);
  const parentalActive = !!parental.pin && lockedCats.size > 0;

  const filtered = useMemo(() => {
    let list: LiveStream[] = perCatEnabled ? categoryItems : [];
    if (deferredSearch) list = filterBySearch(list, (x) => x.name, deferredSearch);
    if (cat === "favorites") list = list.filter((x) => favIds.has(String(x.stream_id)));
    else if (cat === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list.filter((x) => order.has(String(x.stream_id))).sort((a, b) => order.get(String(a.stream_id))! - order.get(String(b.stream_id))!);
    }
    if (parentalActive && (cat === "favorites" || cat === "recent")) {
      list = list.filter((x) => !lockedCats.has(String(x.category_id)));
    }
    if (sort === "az" || sort === "za") list = getSorted(list, (x) => x.name, sort);
    return list;
  }, [categoryItems, perCatEnabled, deferredSearch, cat, favIds, recentIds, sort, parentalActive, lockedCats]);

  const needGate = cat !== "all" && cat !== "favorites" && cat !== "recent" && !!parental.pin && parental.lockedCategories.includes(cat);
  const handleCatChange = useCallback((v: string) => { setCat(v); setUnlocked(false); }, []);

  const activeError = perCatEnabled ? perCatQ.error : null;
  const activeIsError = perCatEnabled ? perCatQ.isError : false;
  const retryActive = () => { if (perCatEnabled) void perCatQ.refetch(); };

  return (
    <PremiumChrome showBack={false}>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-white">
      <XciptvHeader sort={sort} onSort={setSort} search={search} onSearch={setSearch} title="LIVE TV" />
      {needGate && !unlocked ? (
        <div className="px-6"><ParentalGate categoryId={cat} onUnlock={() => setUnlocked(true)} /></div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-stretch sm:flex-row gap-3 px-3 sm:px-5 pb-3 overflow-hidden">
          <XciptvCategoryList
            categories={sidebarCats}
            value={cat}
            onChange={handleCatChange}
            loading={!creds || (categoriesQ.isLoading && !categoriesQ.data)}
            favCount={favIds.size}
            recentCount={recentIds.length}
            totalCount={undefined}
          />
          <div data-tv-scope className="flex-1 basis-0 min-w-0 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pr-1 [-webkit-overflow-scrolling:touch]">
            {!creds || (perCatEnabled && perCatQ.isLoading && !perCatQ.data) ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                {Array.from({ length: 18 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-sm bg-white/[0.05] animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 && activeIsError ? (
              <div className="py-16 text-center text-white/70">
                <Tv className="size-10 mx-auto mb-3 opacity-40" />
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
                <Tv className="size-10 mx-auto mb-3 opacity-40" />
                {cat === "all" ? "Selecione uma categoria à esquerda." : "Nenhum canal encontrado."}
              </div>
            ) : (
              <LiveGrid filtered={filtered} creds={creds} />
            )}
          </div>
        </div>
      )}
      </div>
    </PremiumChrome>
  );
}

function LiveGrid({ filtered, creds }: { filtered: LiveStream[]; creds: XtreamCreds | null }) {
  const { visible, sentinelRef, hasMore } = useProgressive(filtered);
  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {visible.map((s) => (
          <XciptvTile
            key={s.stream_id}
            type="live"
            id={String(s.stream_id)}
            name={s.name}
            image={s.stream_icon}
            // FONTE ÚNICA: streaming layer isolada (src M3U → Xtream .ts).
            src={tryResolveStreamUrl({ src: s.url, stream_id: s.stream_id }, creds) || undefined}
          />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} className="h-8" />}
    </>
  );
}
