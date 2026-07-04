import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PremiumChrome } from "@/components/PremiumChrome";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ParentalGate } from "@/components/ParentalGate";
import { XciptvHeader } from "@/components/xciptv/XciptvHeader";
import { XciptvCategoryList } from "@/components/xciptv/XciptvCategoryList";
import { XciptvTile } from "@/components/xciptv/XciptvTile";
import { store, type XtreamCreds } from "@/lib/storage";
import {
  api,
  isValidLiveStream,
  type LiveCategory,
  type LiveStream,
  xtreamCredsFromUrl,
} from "@/lib/xtream";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { useProgressive } from "@/hooks/use-progressive";
import { filterBySearch, getSorted } from "@/lib/search-index";
import { loadPersisted, withPersist } from "@/lib/query-persist";
import { isNative } from "@/lib/device-profile";
import { Tv, RefreshCw } from "lucide-react";

// Cache v2: chaves separadas, aceita cache sem `url`.
// Não apagamos o cache v1 aqui — apenas ignoramos (evita perder favoritos/histórico).
const K = {
  cats: (acct: string) => `live-cats:v2:${acct}`,
  all: (acct: string) => `live-streams:v2:${acct}:all`,
  cat: (acct: string, cat: string) => `live-streams:v2:${acct}:cat:${cat}`,
  counts: (acct: string) => `live-counts:v1:${acct}`,
  lastCat: (acct: string) => `live-lastcat:v1:${acct}`,
};

function readCounts(acct: string): Record<string, number> {
  if (!acct || typeof localStorage === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(K.counts(acct)) || "{}") || {}; }
  catch { return {}; }
}
function writeCounts(acct: string, map: Record<string, number>) {
  if (!acct || typeof localStorage === "undefined") return;
  try { localStorage.setItem(K.counts(acct), JSON.stringify(map)); } catch { /* quota */ }
}
function readLastCat(acct: string): string | null {
  if (!acct || typeof localStorage === "undefined") return null;
  try { return localStorage.getItem(K.lastCat(acct)); } catch { return null; }
}
function writeLastCat(acct: string, cat: string) {
  if (!acct || typeof localStorage === "undefined") return;
  try { localStorage.setItem(K.lastCat(acct), cat); } catch { /* quota */ }
}

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
    // Sempre prefetch categorias (leve).
    void context.queryClient.prefetchQuery({
      queryKey: ["live-cats", acct],
      queryFn: withPersist(K.cats(acct), () => api<LiveCategory[]>(creds!, "get_live_categories")),
    });
    // Prefetch pesado só em web desktop. No APK Android nunca puxa `all` no loader.
    if (!isNative()) {
      void context.queryClient.prefetchQuery({
        queryKey: ["live-streams", acct, "all"],
        queryFn: withPersist(K.all(acct), () => api<LiveStream[]>(creds!, "get_live_streams")),
      });
    }
  },
  component: LivePage,
});

// Sentinela: "auto" = ainda não escolheu categoria; será resolvida ao chegar categoriesQ.data.
const AUTO = "__auto__";

function LivePage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [cat, setCat] = useState<string>(AUTO);
  const [sort, setSort] = useState<"az" | "za" | "default">("default");
  const [unlocked, setUnlocked] = useState(false);
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [allOptIn, setAllOptIn] = useState(false); // usuário pediu explicitamente "Todas" no APK
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
  const listPersisted = useMemo(() => (acct ? loadPersisted<LiveStream[]>(K.all(acct)) : null), [acct]);
  // Cache válido = pelo menos 1 item com shape Xtream válido. NÃO exige `url`.
  const listInitialData =
    Array.isArray(listPersisted?.data) && listPersisted.data.some(isValidLiveStream)
      ? listPersisted.data
      : undefined;

  const categoriesQ = useQuery({
    queryKey: ["live-cats", acct],
    enabled: !!creds,
    queryFn: withPersist(K.cats(acct), () => api<LiveCategory[]>(creds!, "get_live_categories")),
    initialData: catsPersisted?.data,
    initialDataUpdatedAt: catsPersisted?.updatedAt,
    staleTime: 10 * 60_000,
  });

  const parental = store.getParental();
  const lockedCats = useMemo(
    () => new Set(parental.lockedCategories.map(String)),
    [parental.lockedCategories],
  );
  const parentalActive = !!parental.pin && lockedCats.size > 0;

  // Contadores persistidos por categoria (fonte além do streamsQ).
  const countsMap = useMemo(() => (acct ? readCounts(acct) : {}), [acct]);
  const countsMapRef = useRef<Record<string, number>>(countsMap);
  useEffect(() => { countsMapRef.current = countsMap; }, [countsMap]);
  const [countsBump, setCountsBump] = useState(0); // força re-render quando escrevemos

  // Resolve categoria automaticamente quando `cat === AUTO`.
  useEffect(() => {
    if (cat !== AUTO || !categoriesQ.data) return;
    const remembered = acct ? readLastCat(acct) : null;
    const isPickable = (id: string) => !lockedCats.has(id);
    const pick =
      (remembered && categoriesQ.data.find((c) => c.category_id === remembered && isPickable(c.category_id))?.category_id) ||
      categoriesQ.data.find((c) => isPickable(c.category_id))?.category_id ||
      (native ? null : "all");
    if (pick) setCat(pick);
  }, [cat, categoriesQ.data, acct, lockedCats, native]);

  // streamsQ ("all") só roda:
  //  - em web (não-nativo), OU
  //  - no APK quando o usuário pediu explicitamente "Todas" (allOptIn).
  const streamsEnabled = !!creds && (!native || allOptIn) && cat === "all";
  const streamsQ = useQuery({
    queryKey: ["live-streams", acct, "all"],
    enabled: streamsEnabled,
    queryFn: withPersist(K.all(acct), () => api<LiveStream[]>(creds!, "get_live_streams")),
    initialData: listInitialData,
    initialDataUpdatedAt: listInitialData ? listPersisted?.updatedAt : undefined,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  // Per-category query: leve, roda sempre que uma categoria específica é selecionada.
  const perCatEnabled = !!creds && cat !== "all" && cat !== "favorites" && cat !== "recent" && cat !== AUTO;
  const perCatKey = acct && perCatEnabled ? K.cat(acct, cat) : "";
  const perCatPersisted = useMemo(
    () => (perCatKey ? loadPersisted<LiveStream[]>(perCatKey) : null),
    [perCatKey],
  );
  const perCatInitial =
    Array.isArray(perCatPersisted?.data) && perCatPersisted.data.some(isValidLiveStream)
      ? perCatPersisted.data
      : undefined;
  const perCatQ = useQuery({
    queryKey: ["live-streams", acct, "cat", cat],
    enabled: perCatEnabled,
    queryFn: withPersist(perCatKey, () => api<LiveStream[]>(creds!, "get_live_streams", { category_id: cat })),
    initialData: perCatInitial,
    initialDataUpdatedAt: perCatInitial ? perCatPersisted?.updatedAt : undefined,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  // Ao completar perCatQ, atualiza contador persistido e memoriza last cat.
  useEffect(() => {
    if (!perCatEnabled || !perCatQ.data || !acct) return;
    const n = perCatQ.data.length;
    if (countsMapRef.current[cat] !== n) {
      countsMapRef.current = { ...countsMapRef.current, [cat]: n };
      writeCounts(acct, countsMapRef.current);
      setCountsBump((x) => x + 1);
    }
    writeLastCat(acct, cat);
  }, [perCatEnabled, perCatQ.data, cat, acct]);

  const favs = useFavorites();
  const history = useHistory();
  const favIds = useMemo(() => new Set(favs.filter((f) => f.type === "live").map((f) => f.id)), [favs]);
  const recentIds = useMemo(() => history.filter((h) => h.type === "live").map((h) => h.id), [history]);

  // Contadores: prefere streamsQ.data quando existe (view web), senão mapa persistido.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (streamsQ.data && streamsQ.data.length) {
      for (const s of streamsQ.data) {
        const k = String(s.category_id ?? "");
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    // completa/prevalece com o que já sabemos do mapa persistido
    for (const [k, v] of Object.entries(countsMapRef.current)) {
      if (!m.has(k)) m.set(k, v);
    }
    return m;
  // countsBump força reavaliação sem precisar re-executar useMemo
  }, [streamsQ.data, countsBump]);

  const sidebarCats = useMemo(
    () => (categoriesQ.data ?? []).map((c) => ({
      id: c.category_id,
      name: c.category_name,
      // undefined => componente mostra "—" ou nada; nunca "(0)" antes de confirmar.
      count: counts.has(c.category_id) ? counts.get(c.category_id)! : undefined,
    })),
    [categoriesQ.data, counts],
  );

  const filtered = useMemo(() => {
    // Fonte de dados:
    //  - categoria específica → perCatQ (mesmo que streamsQ falhe/carregando)
    //  - "all"/"favorites"/"recent" → streamsQ
    const source: LiveStream[] =
      perCatEnabled && perCatQ.data ? perCatQ.data : (streamsQ.data ?? []);
    let list: LiveStream[] = source;
    if (deferredSearch) list = filterBySearch(list, (x) => x.name, deferredSearch);
    if (cat === "favorites") list = list.filter((x) => favIds.has(String(x.stream_id)));
    else if (cat === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list.filter((x) => order.has(String(x.stream_id))).sort(
        (a, b) => order.get(String(a.stream_id))! - order.get(String(b.stream_id))!,
      );
    } else if (cat !== "all" && cat !== AUTO && !perCatQ.data) {
      list = list.filter((x) => String(x.category_id) === cat);
    }
    if (parentalActive && (cat === "all" || cat === "favorites" || cat === "recent")) {
      list = list.filter((x) => !lockedCats.has(String(x.category_id)));
    }
    if (sort === "az" || sort === "za") list = getSorted(list, (x) => x.name, sort);
    return list;
  }, [streamsQ.data, perCatQ.data, perCatEnabled, deferredSearch, cat, favIds, recentIds, sort, parentalActive, lockedCats]);

  const needGate =
    cat !== "all" && cat !== "favorites" && cat !== "recent" && cat !== AUTO &&
    !!parental.pin && parental.lockedCategories.includes(cat);

  const handleCatChange = useCallback((v: string) => {
    setCat(v);
    setUnlocked(false);
    if (native && v === "all") setAllOptIn(true); // clicou em Todas de propósito
    if (acct && v !== AUTO && v !== "all" && v !== "favorites" && v !== "recent") {
      writeLastCat(acct, v);
    }
  }, [acct, native]);

  // Estado da consulta ativa
  const activeQ = perCatEnabled ? perCatQ : streamsQ;
  const showSkeleton =
    !creds ||
    (cat === AUTO && !categoriesQ.data) ||
    (perCatEnabled && perCatQ.isLoading && !perCatQ.data) ||
    (!perCatEnabled && cat === "all" && streamsEnabled && streamsQ.isLoading && !streamsQ.data);
  const showError = !showSkeleton && filtered.length === 0 && activeQ.isError && !activeQ.data;
  // "all" no APK sem opt-in: mostrar chamada explícita, não skeleton eterno.
  const showAllOptIn =
    native && cat === "all" && !allOptIn && !streamsQ.data;

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
            value={cat === AUTO ? "" : cat}
            onChange={handleCatChange}
            loading={!creds || (categoriesQ.isLoading && !categoriesQ.data)}
            favCount={favIds.size}
            recentCount={recentIds.length}
            totalCount={streamsQ.data?.length ?? (native && !allOptIn ? undefined : 0)}
          />
          <div data-tv-scope className="flex-1 basis-0 min-w-0 min-h-0 overflow-y-auto overscroll-contain touch-pan-y pr-1 [-webkit-overflow-scrolling:touch]">
            {showAllOptIn ? (
              <div className="py-16 text-center text-white/70 max-w-md mx-auto">
                <Tv className="size-10 mx-auto mb-3 opacity-40" />
                <p className="mb-3">Carregar <b>Todas</b> pode demorar em listas grandes. Prefira abrir uma categoria à esquerda.</p>
                <button
                  onClick={() => setAllOptIn(true)}
                  className="px-4 py-2 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 text-sm"
                >
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
                <Tv className="size-10 mx-auto mb-3 opacity-40" />
                <p className="mb-3">Não foi possível carregar os canais desta categoria.</p>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => activeQ.refetch()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/15 bg-white/10 hover:bg-white/15 text-sm"
                  >
                    <RefreshCw className="size-4" /> Tentar novamente
                  </button>
                  <button
                    onClick={() => setCat(AUTO)}
                    className="px-3 py-2 rounded-lg border border-white/15 bg-white/5 hover:bg-white/10 text-sm"
                  >
                    Selecionar outra categoria
                  </button>
                </div>
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
