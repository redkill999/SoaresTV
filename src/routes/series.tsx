import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { VirtualMediaGrid } from "@/components/VirtualMediaGrid";
import { CategorySidebar } from "@/components/CategorySidebar";
import { SortMenu, type SortKey } from "@/components/SectionTabs";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, type LiveCategory, type Series, xtreamCredsFromUrl } from "@/lib/xtream";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { emptyHint, emptyTitle } from "./live";
import { useTranslation } from "react-i18next";
import { loadPersisted, withPersist } from "@/lib/query-persist";

export const Route = createFileRoute("/series")({
  head: () => ({ meta: [{ title: "Séries — SoaresTV" }] }),
  loader: ({ context }) => {
    let creds = store.getCreds();
    if (!creds) {
      const firstList = store.getM3U()[0];
      const recovered = firstList
        ? xtreamCredsFromUrl(firstList.url, firstList.username, firstList.password)
        : null;
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
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  useEffect(() => {
    const saved = store.getCreds();
    if (saved) {
      setCreds(saved);
      return;
    }
    const firstList = store.getM3U()[0];
    const recovered = firstList
      ? xtreamCredsFromUrl(firstList.url, firstList.username, firstList.password)
      : null;
    if (recovered) {
      store.setCreds(recovered);
      setCreds(recovered);
    }
  }, []);

  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const catsCacheKey = `series-cats:${acct}`;
  const listCacheKey = `series-list:${acct}:all`;
  const catsPersisted = useMemo(
    () => (acct ? loadPersisted<LiveCategory[]>(catsCacheKey) : null),
    [catsCacheKey, acct],
  );
  const listPersisted = useMemo(
    () => (acct ? loadPersisted<Series[]>(listCacheKey) : null),
    [listCacheKey, acct],
  );
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
  });

  const favs = useFavorites();
  const history = useHistory();
  const favIds = useMemo(
    () => new Set(favs.filter((f) => f.type === "series").map((f) => f.id)),
    [favs],
  );
  const recentIds = useMemo(
    () => history.filter((h) => h.type === "series").map((h) => h.id),
    [history],
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of listQ.data ?? []) {
      const k = String(x.category_id ?? "");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [listQ.data]);

  const sidebarCats = useMemo(
    () =>
      (catsQ.data ?? []).map((c) => ({
        id: c.category_id,
        name: c.category_name,
        count: counts.get(c.category_id) ?? 0,
      })),
    [catsQ.data, counts],
  );

  const filtered = useMemo(() => {
    let list = listQ.data ?? [];
    if (cat === "favorites") list = list.filter((s) => favIds.has(String(s.series_id)));
    else if (cat === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list
        .filter((s) => order.has(String(s.series_id)))
        .sort((a, b) => order.get(String(a.series_id))! - order.get(String(b.series_id))!);
    } else if (cat !== "all") {
      list = list.filter((s) => String(s.category_id) === cat);
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((x) => x.name.toLowerCase().includes(s));
    }
    if (sort === "az") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "za") list = [...list].sort((a, b) => b.name.localeCompare(a.name));
    return list;
  }, [listQ.data, search, sort, cat, favIds, recentIds]);

  return (
    <AppShell search={search} onSearch={setSearch}>
      <div className="mb-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-3">
          <Link
            to="/home"
            aria-label={t("common.back")}
            className="shrink-0 inline-flex items-center justify-center size-10 rounded-full border border-border bg-card/50 hover:bg-card transition-colors"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight truncate">
              {t("pages.series.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("pages.series.subtitle")}</p>
          </div>
          <div className="shrink-0">
            <SortMenu value={sort} onChange={setSort} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <CategorySidebar
          categories={sidebarCats}
          value={cat}
          onChange={setCat}
          loading={!creds || (catsQ.isLoading && !catsQ.data)}
          favCount={favIds.size}
          recentCount={recentIds.length}
          totalCount={listQ.data?.length ?? 0}
        />

        <div className="min-w-0 flex-1">
          <VirtualMediaGrid
            items={filtered}
            loading={!creds || (listQ.isLoading && filtered.length === 0)}
            empty={!!creds && !listQ.isLoading && filtered.length === 0}
            aspect="square"
            emptyIcon={<Clapperboard className="size-7" />}
            emptyTitle={emptyTitle(cat, "series")}
            emptyHint={emptyHint(cat, search)}
            getKey={(s) => s.series_id}
            renderItem={(s) => (
              <MediaCard
                type="series"
                id={s.series_id}
                name={s.name}
                image={s.cover}
                aspect="square"
              />
            )}
          />
        </div>
      </div>
    </AppShell>
  );
}
