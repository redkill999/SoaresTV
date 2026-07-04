import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PremiumChrome } from "@/components/PremiumChrome";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ParentalGate } from "@/components/ParentalGate";
import { XciptvHeader } from "@/components/xciptv/XciptvHeader";
import { XciptvCategoryList } from "@/components/xciptv/XciptvCategoryList";
import { XciptvTile } from "@/components/xciptv/XciptvTile";
import { MediaCard } from "@/components/MediaCard";
import { store, type XtreamCreds, type HistItem } from "@/lib/storage";
import { api, type LiveCategory, type VodStream, xtreamCredsFromUrl } from "@/lib/xtream";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { useProgressive } from "@/hooks/use-progressive";
import { filterBySearch, getSorted } from "@/lib/search-index";
import { loadPersisted, withPersist } from "@/lib/query-persist";
import { isNative } from "@/lib/device-profile";
import { timed } from "@/lib/iptv-log";
import { Film, RefreshCw } from "lucide-react";

const PROVIDER = "xtream";
const K = {
  cats: (a: string) => `vod-cats:v2:${PROVIDER}:${a}`,
  all: (a: string) => `vod-list:v2:${PROVIDER}:${a}:all`,
  cat: (a: string, c: string) => `vod-list:v2:${PROVIDER}:${a}:category:${c}`,
  counts: (a: string) => `vod-counts:v1:${PROVIDER}:${a}`,
};
const QK = {
  cats: (a: string) => ["vod-cats", PROVIDER, a] as const,
  all: (a: string) => ["vod-list", PROVIDER, a, "all"] as const,
  cat: (a: string, c: string) => ["vod-list", PROVIDER, a, "category", c] as const,
};
const AUTO = "__auto__";

function readCounts(a: string): Record<string, number> {
  if (!a || typeof localStorage === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(K.counts(a)) || "{}") || {}; }
  catch { return {}; }
}
function writeCounts(a: string, m: Record<string, number>) {
  if (!a || typeof localStorage === "undefined") return;
  try { localStorage.setItem(K.counts(a), JSON.stringify(m)); } catch {}
}

export const Route = createFileRoute("/movies")({
  head: () => ({ meta: [{ title: "Filmes — SoaresTV" }] }),
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
      queryKey: QK.cats(acct),
      queryFn: withPersist(K.cats(acct), () =>
        timed("get_vod_categories", () => api<LiveCategory[]>(creds!, "get_vod_categories"), {
          countOf: (v) => (Array.isArray(v) ? v.length : 0),
        }),
      ),
    });
    // Prefetch da lista global apenas em web desktop. No APK/TV nunca puxa "all"
    // no loader — evita ANR ao entrar em /movies.
    if (!isNative()) {
      void context.queryClient.prefetchQuery({
        queryKey: QK.all(acct),
        queryFn: withPersist(K.all(acct), () =>
          timed("get_vod_streams", () => api<VodStream[]>(creds!, "get_vod_streams"), {
            countOf: (v) => (Array.isArray(v) ? v.length : 0),
          }),
        ),
      });
    }
  },
  component: MoviesPage,
});

function MoviesPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [cat, setCat] = useState<string>(AUTO);
  const [sort, setSort] = useState<"az" | "za" | "default">("default");
  const [unlocked, setUnlocked] = useState(false);
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [allOptIn, setAllOptIn] = useState(false);
  const native = isNative();

  useEffect(() => {
    const saved = store.getCreds();
    if (saved) { setCreds(saved); return; }
    const firstList = store.getM3U()[0];
    const recovered = firstList ? xtreamCredsFromUrl(firstList.url, firstList.username, firstList.password) : null;
    if (recovered) setCreds(recovered);
  }, []);

  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const catsPersisted = useMemo(() => (acct ? loadPersisted<LiveCategory[]>(K.cats(acct)) : null), [acct]);
  const listPersisted = useMemo(() => (acct ? loadPersisted<VodStream[]>(K.all(acct)) : null), [acct]);

  const catsQ = useQuery({
    queryKey: QK.cats(acct),
    enabled: !!creds,
    queryFn: withPersist(K.cats(acct), () =>
      timed("get_vod_categories", () => api<LiveCategory[]>(creds!, "get_vod_categories")),
    ),
    initialData: catsPersisted?.data,
    initialDataUpdatedAt: catsPersisted?.updatedAt,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const parental = store.getParental();
  const lockedCats = useMemo(() => new Set(parental.lockedCategories.map(String)), [parental.lockedCategories]);
  const parentalActive = !!parental.pin && lockedCats.size > 0;

  const countsMap = useMemo(() => (acct ? readCounts(acct) : {}), [acct]);
  const countsMapRef = useRef<Record<string, number>>(countsMap);
  useEffect(() => { countsMapRef.current = countsMap; }, [countsMap]);
  const [countsBump, setCountsBump] = useState(0);

  const autoResolvedRef = useRef<string | null>(null);
  useEffect(() => {
    if (autoResolvedRef.current && autoResolvedRef.current !== acct) {
      autoResolvedRef.current = null;
      setCat(AUTO);
      setAllOptIn(false);
    }
  }, [acct]);
  useEffect(() => {
    if (cat !== AUTO || !catsQ.data || !acct) return;
    if (autoResolvedRef.current === acct) return;
    const pick = catsQ.data.find((c) => !lockedCats.has(c.category_id))?.category_id
      ?? (native ? null : "all");
    if (pick) {
      autoResolvedRef.current = acct;
      setCat(pick);
    }
  }, [cat, catsQ.data, acct, lockedCats, native]);

  const streamsEnabled = !!creds && (!native || allOptIn) && cat === "all";
  const listQ = useQuery({
    queryKey: QK.all(acct),
    enabled: streamsEnabled,
    queryFn: withPersist(K.all(acct), () =>
      timed("get_vod_streams", () => api<VodStream[]>(creds!, "get_vod_streams")),
    ),
    initialData: listPersisted?.data,
    initialDataUpdatedAt: listPersisted?.updatedAt,
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  const perCatEnabled = !!creds && cat !== "all" && cat !== "favorites" && cat !== "recent" && cat !== AUTO;
  const perCatKey = acct && perCatEnabled ? K.cat(acct, cat) : "";
  const perCatPersisted = useMemo(
    () => (perCatKey ? loadPersisted<VodStream[]>(perCatKey) : null),
    [perCatKey],
  );
  const perCatQ = useQuery({
    queryKey: QK.cat(acct, cat),
    enabled: perCatEnabled,
    queryFn: withPersist(perCatKey, () =>
      timed(
        "get_vod_streams",
        () => api<VodStream[]>(creds!, "get_vod_streams", { category_id: cat }),
        { category_id: cat, countOf: (v) => (Array.isArray(v) ? v.length : 0) },
      ),
    ),
    initialData: perCatPersisted?.data,
    initialDataUpdatedAt: perCatPersisted?.updatedAt,
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });

  useEffect(() => {
    if (!perCatEnabled || !perCatQ.data || !acct) return;
    const n = perCatQ.data.length;
    if (countsMapRef.current[cat] !== n) {
      countsMapRef.current = { ...countsMapRef.current, [cat]: n };
      writeCounts(acct, countsMapRef.current);
      setCountsBump((x) => x + 1);
    }
  }, [perCatEnabled, perCatQ.data, cat, acct]);

  const favs = useFavorites();
  const history = useHistory();
  const favIds = useMemo(() => new Set(favs.filter((f) => f.type === "movie").map((f) => f.id)), [favs]);
  const recentIds = useMemo(() => history.filter((h) => h.type === "movie").map((h) => h.id), [history]);
  const progressMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of history) {
      if (h.type !== "movie") continue;
      if (!h.position || !h.duration) continue;
      const p = h.position / h.duration;
      if (p > 0) m.set(h.id, p);
    }
    return m;
  }, [history]);
  const continueWatching = useMemo(() => {
    return (history as HistItem[])
      .filter((h) => h.type === "movie" && h.position && h.duration)
      .filter((h) => {
        const p = (h.position ?? 0) / (h.duration ?? 1);
        return p >= 0.05 && p <= 0.95;
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 10);
  }, [history]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (listQ.data?.length) {
      for (const x of listQ.data) {
        const k = String(x.category_id ?? "");
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    for (const [k, v] of Object.entries(countsMapRef.current)) {
      if (!m.has(k)) m.set(k, v);
    }
    return m;
  }, [listQ.data, countsBump]);

  const sidebarCats = useMemo(
    () => (catsQ.data ?? []).map((c) => ({
      id: c.category_id,
      name: c.category_name,
      count: counts.has(c.category_id) ? counts.get(c.category_id)! : undefined,
    })),
    [catsQ.data, counts],
  );

  const needGate = cat !== "all" && cat !== "favorites" && cat !== "recent" && cat !== AUTO && !!parental.pin && parental.lockedCategories.includes(cat);
  const handleCatChange = useCallback((v: string) => {
    setCat(v);
    setUnlocked(false);
    if (native && v === "all") setAllOptIn(true);
  }, [native]);

  const filtered = useMemo(() => {
    const source: VodStream[] =
      perCatEnabled && perCatQ.data ? perCatQ.data : (listQ.data ?? []);
    let list: VodStream[] = source;
    const idOf = (m: VodStream) => `${m.stream_id}.${m.container_extension || "mp4"}`;
    if (deferredSearch) list = filterBySearch(list, (x) => x.name, deferredSearch);
    if (cat === "favorites") list = list.filter((m) => favIds.has(idOf(m)));
    else if (cat === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list.filter((m) => order.has(idOf(m))).sort((a, b) => order.get(idOf(a))! - order.get(idOf(b))!);
    } else if (cat !== "all" && cat !== AUTO && !perCatQ.data) {
      list = list.filter((m) => String(m.category_id) === cat);
    }
    if (parentalActive && (cat === "all" || cat === "favorites" || cat === "recent")) {
      list = list.filter((m) => !lockedCats.has(String(m.category_id)));
    }
    if (sort === "az" || sort === "za") list = getSorted(list, (x) => x.name, sort);
    return list;
  }, [listQ.data, perCatQ.data, perCatEnabled, deferredSearch, sort, cat, favIds, recentIds, parentalActive, lockedCats]);

  const activeQ = perCatEnabled ? perCatQ : listQ;
  const showAllOptIn = native && cat === "all" && !allOptIn && !listQ.data;
  const showSkeleton =
    !creds ||
    (cat === AUTO && !catsQ.data) ||
    (perCatEnabled && perCatQ.isLoading && !perCatQ.data) ||
    (!perCatEnabled && cat === "all" && streamsEnabled && listQ.isLoading && !listQ.data);
  const showError = !showSkeleton && filtered.length === 0 && activeQ.isError && !activeQ.data;

  return (
    <PremiumChrome showBack={false}>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden text-white">
      <XciptvHeader sort={sort} onSort={setSort} search={search} onSearch={setSearch} title="MOVIES" />
      {needGate && !unlocked ? (
        <div className="px-6"><ParentalGate categoryId={cat} onUnlock={() => setUnlocked(true)} /></div>
      ) : (
      <div className="flex-1 min-h-0 flex flex-col items-stretch sm:flex-row gap-3 px-3 sm:px-5 pb-3 overflow-hidden">
        <XciptvCategoryList
          categories={sidebarCats}
          value={cat === AUTO ? "" : cat}
          onChange={handleCatChange}
          loading={!creds || (catsQ.isLoading && !catsQ.data)}
          favCount={favIds.size}
          recentCount={recentIds.length}
          totalCount={listQ.data?.length ?? (native && !allOptIn ? undefined : 0)}
        />
        <div data-tv-scope className="flex-1 basis-0 min-w-0 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pr-1 [-webkit-overflow-scrolling:touch]">
          {continueWatching.length > 0 && (
            <section className="mb-4">
              <h2 className="text-xs uppercase tracking-widest text-white/70 mb-2 px-0.5">Continue assistindo</h2>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {continueWatching.map((h) => (
                  <div key={h.id} className="shrink-0 w-28">
                    <MediaCard type="movie" id={h.id} name={h.name} image={h.logo} aspect="poster" progress={(h.position ?? 0) / (h.duration ?? 1)} />
                  </div>
                ))}
              </div>
            </section>
          )}
          {showAllOptIn ? (
            <div className="py-16 text-center text-white/70 max-w-md mx-auto">
              <Film className="size-10 mx-auto mb-3 opacity-40" />
              <p className="mb-3">Carregar <b>Todas</b> pode demorar em catálogos grandes. Prefira abrir uma categoria à esquerda.</p>
              <button onClick={() => setAllOptIn(true)} className="px-4 py-2 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 text-sm">
                Carregar Todas mesmo assim
              </button>
            </div>
          ) : showSkeleton ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-sm bg-white/[0.05] animate-pulse" />
              ))}
            </div>
          ) : showError ? (
            <div className="py-16 text-center text-white/70 max-w-md mx-auto">
              <Film className="size-10 mx-auto mb-3 opacity-40" />
              <p className="mb-3">Não foi possível carregar os filmes desta categoria.</p>
              <div className="flex gap-2 justify-center">
                <button onClick={() => activeQ.refetch()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 text-sm">
                  <RefreshCw className="size-4" /> Tentar novamente
                </button>
                <button onClick={() => setCat(AUTO)} className="px-3 py-2 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-sm">
                  Selecionar outra categoria
                </button>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-white/60">
              <Film className="size-10 mx-auto mb-3 opacity-40" />
              {cat === "all" && !listQ.data
                ? "Lista muito grande para carregar tudo. Selecione uma categoria à esquerda."
                : "Nenhum filme encontrado."}
            </div>
          ) : (
            <MovieGrid filtered={filtered} progressMap={progressMap} />
          )}
        </div>
      </div>
      )}
      </div>
    </PremiumChrome>
  );
}

function MovieGrid({ filtered, progressMap }: { filtered: VodStream[]; progressMap: Map<string, number> }) {
  const { visible, sentinelRef, hasMore } = useProgressive(filtered);
  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
        {visible.map((m) => {
          const id = `${m.stream_id}.${m.container_extension || "mp4"}`;
          return (
            <XciptvTile
              key={m.stream_id}
              type="movie"
              id={id}
              name={m.name}
              image={m.stream_icon}
              progress={progressMap.get(id)}
            />
          );
        })}
      </div>
      {hasMore && <div ref={sentinelRef} className="h-8" />}
    </>
  );
}
