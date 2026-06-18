import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { MediaGrid } from "@/components/MediaGrid";
import { CatChip, SectionTabs, SortMenu, type SortKey, type TabKey } from "@/components/SectionTabs";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, type LiveCategory, type Series, xtreamCredsFromUrl } from "@/lib/xtream";
import { ArrowLeft, Clapperboard } from "lucide-react";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { emptyHint, emptyTitle } from "./live";

export const Route = createFileRoute("/series")({
  head: () => ({ meta: [{ title: "Séries — SoaresTV" }] }),
  component: SeriesPage,
});

function SeriesPage() {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [tab, setTab] = useState<TabKey>("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedCreds = store.getCreds();
    if (savedCreds) {
      setCreds(savedCreds);
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
  const catsQ = useQuery({
    queryKey: ["series-cats", acct],
    enabled: !!creds,
    queryFn: () => api<LiveCategory[]>(creds!, "get_series_categories"),
  });
  const listQ = useQuery({
    queryKey: ["series-list", acct, cat],
    enabled: !!creds,
    queryFn: () =>
      api<Series[]>(creds!, "get_series", cat !== "all" ? { category_id: cat } : undefined),
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

  const filtered = useMemo(() => {
    let list = listQ.data ?? [];
    if (tab === "favorites") list = list.filter((s) => favIds.has(String(s.series_id)));
    if (tab === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list
        .filter((s) => order.has(String(s.series_id)))
        .sort((a, b) => order.get(String(a.series_id))! - order.get(String(b.series_id))!);
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
            aria-label="Voltar ao menu"
            className="shrink-0 inline-flex items-center justify-center size-10 rounded-full border border-border bg-card/50 hover:bg-card transition-colors"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight truncate">
              Séries
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Temporadas e episódios
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
        emptyIcon={<Clapperboard className="size-7" />}
        emptyTitle={emptyTitle(tab, "série")}
        emptyHint={emptyHint(tab, search)}
      >
        {filtered.map((s) => (
          <MediaCard
            key={s.series_id}
            type="series"
            id={s.series_id}
            name={s.name}
            image={s.cover}
            aspect="poster"
          />
        ))}
      </MediaGrid>
    </AppShell>
  );
}
