import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PremiumChrome } from "@/components/PremiumChrome";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ParentalGate } from "@/components/ParentalGate";
import { XciptvHeader } from "@/components/xciptv/XciptvHeader";
import { XciptvCategoryList } from "@/components/xciptv/XciptvCategoryList";
import { XciptvTile } from "@/components/xciptv/XciptvTile";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, type LiveCategory, type LiveStream, xtreamCredsFromUrl } from "@/lib/xtream";
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
    void context.queryClient.prefetchQuery({
      queryKey: ["live-cats", acct],
      queryFn: withPersist(`live-cats:${acct}`, () => api<LiveCategory[]>(creds!, "get_live_categories")),
    });
    void context.queryClient.prefetchQuery({
      queryKey: ["live-streams", acct, "all"],
      queryFn: withPersist(`live-streams:${acct}:all`, () => api<LiveStream[]>(creds!, "get_live_streams")),
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
  useEffect(() => {
    const saved = store.getCreds();
    if (saved) { setCreds(saved); return; }
    // Sem creds salvas: só recuperamos localmente da primeira lista (sem
    // persistir com setCreds), para nunca trocar a lista do usuário de
    // forma silenciosa quando a atual expirar.
    const firstList = store.getM3U()[0];
    const recovered = firstList ? xtreamCredsFromUrl(firstList.url, firstList.username, firstList.password) : null;
    if (recovered) setCreds(recovered);
  }, []);


  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const catsCacheKey = `live-cats:${acct}`;
  const listCacheKey = `live-streams:${acct}:all`;
  const nonEmptyArr = <T,>(v: T[] | undefined | null): v is T[] => Array.isArray(v) && v.length > 0;
  const catsPersisted = useMemo(() => (acct ? loadPersisted<LiveCategory[]>(catsCacheKey) : null), [catsCacheKey, acct]);
  const listPersisted = useMemo(() => (acct ? loadPersisted<LiveStream[]>(listCacheKey) : null), [listCacheKey, acct]);
  // Nunca use um array vazio persistido como initialData válido — força refetch.
  const listInitialData = nonEmptyArr(listPersisted?.data) && listPersisted!.data.some((s) => !!s.url)
    ? listPersisted!.data
    : undefined;
  const catsInitialData = nonEmptyArr(catsPersisted?.data) ? catsPersisted!.data : undefined;
  const categoriesQ = useQuery({
    queryKey: ["live-cats", acct],
    enabled: !!creds,
    queryFn: withPersist(catsCacheKey, () => api<LiveCategory[]>(creds!, "get_live_categories")),
    initialData: catsInitialData,
    initialDataUpdatedAt: catsInitialData ? catsPersisted?.updatedAt : undefined,
    staleTime: 10 * 60_000,
    refetchOnMount: catsInitialData ? false : "always",
    refetchOnReconnect: true,
  });
  const streamsQ = useQuery({
    queryKey: ["live-streams", acct, "all"],
    enabled: !!creds,
    queryFn: withPersist(
      listCacheKey,
      () => api<LiveStream[]>(creds!, "get_live_streams"),
      { shouldPersist: (data) => Array.isArray(data) && data.length > 0 },
    ),
    initialData: listInitialData,
    initialDataUpdatedAt: listInitialData ? listPersisted?.updatedAt : undefined,
    staleTime: 10 * 60_000,
    retry: 1,
    refetchOnMount: listInitialData ? false : "always",
    refetchOnReconnect: true,
  });
  // Fallback per-category: painéis grandes (60MB+) muitas vezes falham no
  // get_live_streams "all" no APK TV. Ao selecionar uma categoria, buscamos
  // só ela — muito mais leve — para o app funcionar mesmo sem a lista total.
  const perCatEnabled = !!creds && cat !== "all" && cat !== "favorites" && cat !== "recent";
  const perCatKey = `live-streams:${acct}:cat:${cat}`;
  const perCatPersisted = useMemo(
    () => (perCatEnabled ? loadPersisted<LiveStream[]>(perCatKey) : null),
    [perCatEnabled, perCatKey],
  );
  const perCatInitial = nonEmptyArr(perCatPersisted?.data) ? perCatPersisted!.data : undefined;
  const perCatQ = useQuery({
    queryKey: ["live-streams", acct, "cat", cat],
    enabled: perCatEnabled,
    queryFn: withPersist(
      perCatKey,
      () => api<LiveStream[]>(creds!, "get_live_streams", { category_id: cat }),
      { shouldPersist: (data) => Array.isArray(data) && data.length > 0 },
    ),
    initialData: perCatInitial,
    initialDataUpdatedAt: perCatInitial ? perCatPersisted?.updatedAt : undefined,
    staleTime: 10 * 60_000,
    refetchOnMount: perCatInitial ? false : "always",
    refetchOnReconnect: true,
  });
  const hasPerCategoryData = Array.isArray(perCatQ.data) && perCatQ.data.length > 0;

  const favs = useFavorites();
  const history = useHistory();
  const favIds = useMemo(() => new Set(favs.filter((f) => f.type === "live").map((f) => f.id)), [favs]);
  const recentIds = useMemo(() => history.filter((h) => h.type === "live").map((h) => h.id), [history]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of streamsQ.data ?? []) {
      const k = String(s.category_id ?? "");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [streamsQ.data]);

  const sidebarCats = useMemo(
    () => (categoriesQ.data ?? []).map((c) => ({ id: c.category_id, name: c.category_name, count: counts.get(c.category_id) ?? 0 })),
    [categoriesQ.data, counts],
  );

  const parental = store.getParental();
  const lockedCats = useMemo(
    () => new Set(parental.lockedCategories.map(String)),
    [parental.lockedCategories],
  );
  const parentalActive = !!parental.pin && lockedCats.size > 0;

  const filtered = useMemo(() => {
    // Se uma categoria específica está selecionada e o per-cat trouxe itens,
    // usamos ele como fonte principal. Array vazio NÃO conta como "tem dados".
    const source: LiveStream[] =
      perCatEnabled && hasPerCategoryData ? (perCatQ.data as LiveStream[]) : (streamsQ.data ?? []);
    let list: LiveStream[] = source;
    if (deferredSearch) list = filterBySearch(list, (x) => x.name, deferredSearch);
    if (cat === "favorites") list = list.filter((x) => favIds.has(String(x.stream_id)));
    else if (cat === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list.filter((x) => order.has(String(x.stream_id))).sort((a, b) => order.get(String(a.stream_id))! - order.get(String(b.stream_id))!);
    } else if (cat !== "all" && !hasPerCategoryData) {
      // Só filtra pelo streamsQ se não veio do per-cat (que já vem filtrado).
      list = list.filter((x) => String(x.category_id) === cat);
    }
    if (parentalActive && (cat === "all" || cat === "favorites" || cat === "recent")) {
      list = list.filter((x) => !lockedCats.has(String(x.category_id)));
    }
    if (sort === "az" || sort === "za") list = getSorted(list, (x) => x.name, sort);
    return list;
  }, [streamsQ.data, perCatQ.data, perCatEnabled, hasPerCategoryData, deferredSearch, cat, favIds, recentIds, sort, parentalActive, lockedCats]);

  const needGate = cat !== "all" && cat !== "favorites" && cat !== "recent" && !!parental.pin && parental.lockedCategories.includes(cat);
  const handleCatChange = useCallback((v: string) => { setCat(v); setUnlocked(false); }, []);

  // Erro real (timeout / rede) na fonte ativa — mostra retry.
  const activeError = perCatEnabled ? perCatQ.error : streamsQ.error;
  const activeIsError = perCatEnabled ? perCatQ.isError : streamsQ.isError;
  const retryActive = () => { if (perCatEnabled) void perCatQ.refetch(); else void streamsQ.refetch(); };

  return (
    <PremiumChrome>
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
            totalCount={streamsQ.data?.length ?? 0}
          />
          <div data-tv-scope className="flex-1 basis-0 min-w-0 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pr-1 [-webkit-overflow-scrolling:touch]">
            {!creds || (streamsQ.isLoading && !streamsQ.data && !perCatQ.data) || (perCatEnabled && perCatQ.isLoading && !perCatQ.data) ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                {Array.from({ length: 18 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-sm bg-white/[0.05] animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 && activeIsError ? (
              <div className="py-16 text-center text-white/70">
                <Tv className="size-10 mx-auto mb-3 opacity-40" />
                <p className="mb-3">Não foi possível carregar os canais {perCatEnabled ? "desta categoria" : ""}.</p>
                {activeError instanceof Error && (
                  <p className="text-xs text-white/40 mb-3">{activeError.message}</p>
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
                {cat === "all" && !streamsQ.data
                  ? "Lista muito grande para carregar tudo. Selecione uma categoria à esquerda."
                  : "Nenhum canal encontrado."}
              </div>
            ) : (
              <LiveGrid filtered={filtered} />
            )}
          </div>
        </div>
      )}
      </div>
    </PremiumChrome>
  );
}

function LiveGrid({ filtered }: { filtered: LiveStream[] }) {
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
            src={s.url}
          />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} className="h-8" />}
    </>
  );
}
