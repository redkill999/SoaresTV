import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { MediaGrid } from "@/components/MediaGrid";
import { CatChip, CatChipsSkeleton, SectionTabs, SortMenu, type SortKey, type TabKey } from "@/components/SectionTabs";
import { ParentalGate } from "@/components/ParentalGate";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, type LiveCategory, type LiveStream } from "@/lib/xtream";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Tv } from "lucide-react";
import { useFavorites, useHistory } from "@/hooks/use-favorites";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Ao Vivo — SoaresTV" }] }),
  // Prefetch ao passar o mouse / focar no link do menu (defaultPreload: "intent").
  loader: ({ context }) => {
    const creds = store.getCreds();
    if (!creds) return;
    const acct = `${creds.server}|${creds.username}`;
    void context.queryClient.prefetchQuery({
      queryKey: ["live-cats", acct],
      queryFn: () => api<LiveCategory[]>(creds, "get_live_categories"),
    });
    void context.queryClient.prefetchQuery({
      queryKey: ["live-streams", acct, "all"],
      queryFn: () => api<LiveStream[]>(creds, "get_live_streams"),
    });
  },
  component: LivePage,
});

function LivePage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [tab, setTab] = useState<TabKey>("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [unlocked, setUnlocked] = useState(false);
  // Lê creds só depois da hidratação para evitar mismatch SSR/CSR.
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  useEffect(() => setCreds(store.getCreds()), []);

  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const categoriesQ = useQuery({
    queryKey: ["live-cats", acct],
    enabled: !!creds,
    queryFn: () => api<LiveCategory[]>(creds!, "get_live_categories"),
  });
  const streamsQ = useQuery({
    queryKey: ["live-streams", acct, cat],
    enabled: !!creds,
    queryFn: () =>
      api<LiveStream[]>(
        creds!,
        "get_live_streams",
        cat !== "all" ? { category_id: cat } : undefined,
      ),
  });

  const favs = useFavorites();
  const history = useHistory();
  const favIds = useMemo(
    () => new Set(favs.filter((f) => f.type === "live").map((f) => f.id)),
    [favs],
  );
  const recentIds = useMemo(
    () => history.filter((h) => h.type === "live").map((h) => h.id),
    [history],
  );

  const filtered = useMemo(() => {
    let list = streamsQ.data ?? [];
    if (tab === "favorites") list = list.filter((x) => favIds.has(String(x.stream_id)));
    if (tab === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list
        .filter((x) => order.has(String(x.stream_id)))
        .sort((a, b) => (order.get(String(a.stream_id))! - order.get(String(b.stream_id))!));
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((x) => x.name.toLowerCase().includes(s));
    }
    if (sort === "az") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "za") list = [...list].sort((a, b) => b.name.localeCompare(a.name));
    return list;
  }, [streamsQ.data, search, sort, tab, favIds, recentIds]);

  const parental = useMemo(() => store.getParental(), [cat]);
  const needGate = cat !== "all" && !!parental.pin && parental.lockedCategories.includes(cat);
  if (needGate && !unlocked) {
    return (
      <AppShell>
        <ParentalGate categoryId={cat} onUnlock={() => setUnlocked(true)} />
      </AppShell>
    );
  }


  return (
    <AppShell search={search} onSearch={setSearch}>
      <Header
        title={t("pages.live.title")}
        subtitle={t("pages.live.subtitle")}
        tab={tab}
        setTab={setTab}
        sort={sort}
        setSort={setSort}
        counts={{ favorites: favIds.size, recent: recentIds.length }}
      />

      <div className="flex gap-2 overflow-x-auto pb-3 mb-5 -mx-1 px-1 scrollbar-thin">
        <CatChip active={cat === "all"} onClick={() => setCat("all")}>
          {t("pages.allCategories")}
        </CatChip>
        {!creds || (categoriesQ.isLoading && !categoriesQ.data) ? (
          <CatChipsSkeleton />
        ) : (
          (categoriesQ.data ?? []).map((c) => (
            <CatChip
              key={c.category_id}
              active={cat === c.category_id}
              onClick={() => {
                setCat(c.category_id);
                setUnlocked(false);
              }}
            >
              {c.category_name}
            </CatChip>
          ))
        )}
      </div>

      <MediaGrid
        loading={!creds || streamsQ.isLoading}
        empty={!!creds && !streamsQ.isLoading && filtered.length === 0}
        aspect="wide"
        emptyIcon={<Tv className="size-7" />}
        emptyTitle={emptyTitle(tab, "channel")}
        emptyHint={emptyHint(tab, search)}
      >
        {filtered.map((s) => (
          <MediaCard
            key={s.stream_id}
            type="live"
            id={s.stream_id}
            name={s.name}
            image={s.stream_icon}
            badge="LIVE"
            aspect="wide"
          />
        ))}
      </MediaGrid>
    </AppShell>
  );
}

function Header({
  title,
  subtitle,
  tab,
  setTab,
  sort,
  setSort,
  counts,
}: {
  title: string;
  subtitle: string;
  tab: TabKey;
  setTab: (v: TabKey) => void;
  sort: SortKey;
  setSort: (v: SortKey) => void;
  counts: Partial<Record<TabKey, number>>;
}) {
  const { t } = useTranslation();
  return (
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
            {title}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <div className="shrink-0">
          <SortMenu value={sort} onChange={setSort} />
        </div>
      </div>
      <SectionTabs value={tab} onChange={setTab} counts={counts} />
    </div>
  );
}

export function emptyTitle(tab: TabKey, itemKey: "channel" | "movie" | "series") {
  const item = i18n.t(`empty.${itemKey}`);
  if (tab === "favorites") return i18n.t("empty.noFav", { item });
  if (tab === "recent") return i18n.t("empty.noRecent", { item });
  return i18n.t("empty.noResults");
}
export function emptyHint(tab: TabKey, search: string) {
  if (search) return i18n.t("empty.searchHint", { q: search });
  if (tab === "favorites") return i18n.t("empty.favHint");
  if (tab === "recent") return i18n.t("empty.recentHint");
  return i18n.t("empty.defaultHint");
}
