import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { MediaGrid } from "@/components/MediaGrid";
import { CategorySidebar } from "@/components/CategorySidebar";
import { SortMenu, type SortKey } from "@/components/SectionTabs";
import { ParentalGate } from "@/components/ParentalGate";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, type LiveCategory, type LiveStream } from "@/lib/xtream";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Tv } from "lucide-react";
import { useFavorites, useHistory } from "@/hooks/use-favorites";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Ao Vivo — SoaresTV" }] }),
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
  const deferredSearch = useDeferredValue(search);
  const [cat, setCat] = useState<string>("all"); // "all" | "favorites" | "recent" | category_id
  const [sort, setSort] = useState<SortKey>("default");
  const [unlocked, setUnlocked] = useState(false);
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  useEffect(() => setCreds(store.getCreds()), []);

  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const categoriesQ = useQuery({
    queryKey: ["live-cats", acct],
    enabled: !!creds,
    queryFn: () => api<LiveCategory[]>(creds!, "get_live_categories"),
  });
  const streamsQ = useQuery({
    queryKey: ["live-streams", acct, "all"],
    enabled: !!creds,
    queryFn: () => api<LiveStream[]>(creds!, "get_live_streams"),
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

  // counts per category
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of streamsQ.data ?? []) {
      const k = String(s.category_id ?? "");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [streamsQ.data]);

  const sidebarCats = useMemo(
    () =>
      (categoriesQ.data ?? []).map((c) => ({
        id: c.category_id,
        name: c.category_name,
        count: counts.get(c.category_id) ?? 0,
      })),
    [categoriesQ.data, counts],
  );

  const filtered = useMemo(() => {
    let list = streamsQ.data ?? [];
    if (cat === "favorites") list = list.filter((x) => favIds.has(String(x.stream_id)));
    else if (cat === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list
        .filter((x) => order.has(String(x.stream_id)))
        .sort((a, b) => order.get(String(a.stream_id))! - order.get(String(b.stream_id))!);
    } else if (cat !== "all") {
      list = list.filter((x) => String(x.category_id) === cat);
    }
    if (deferredSearch) {
      const s = deferredSearch.toLowerCase();
      list = list.filter((x) => x.name.toLowerCase().includes(s));
    }
    if (sort === "az") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "za") list = [...list].sort((a, b) => b.name.localeCompare(a.name));
    return list;
  }, [streamsQ.data, deferredSearch, sort, cat, favIds, recentIds]);

  const parental = useMemo(() => store.getParental(), [cat]);
  const needGate =
    cat !== "all" &&
    cat !== "favorites" &&
    cat !== "recent" &&
    !!parental.pin &&
    parental.lockedCategories.includes(cat);
  if (needGate && !unlocked) {
    return (
      <AppShell>
        <ParentalGate categoryId={cat} onUnlock={() => setUnlocked(true)} />
      </AppShell>
    );
  }

  return (
    <AppShell search={search} onSearch={setSearch}>
      <Header title={t("pages.live.title")} subtitle={t("pages.live.subtitle")} sort={sort} setSort={setSort} />

      <div className="flex flex-col gap-4 sm:flex-row">
        <CategorySidebar
          categories={sidebarCats}
          value={cat}
          onChange={(v) => {
            setCat(v);
            setUnlocked(false);
          }}
          loading={!creds || (categoriesQ.isLoading && !categoriesQ.data)}
          favCount={favIds.size}
          recentCount={recentIds.length}
          totalCount={streamsQ.data?.length ?? 0}
        />

        <div className="min-w-0 flex-1">
          <MediaGrid
            loading={!creds || streamsQ.isLoading}
            empty={!!creds && !streamsQ.isLoading && filtered.length === 0}
            aspect="square"
            emptyIcon={<Tv className="size-7" />}
            emptyTitle={emptyTitle(cat, "channel")}
            emptyHint={emptyHint(cat, search)}
          >
            {filtered.map((s) => (
              <MediaCard
                key={s.stream_id}
                type="live"
                id={s.stream_id}
                name={s.name}
                image={s.stream_icon}
                badge="LIVE"
                aspect="square"
              />
            ))}
          </MediaGrid>
        </div>
      </div>
    </AppShell>
  );
}

function Header({
  title,
  subtitle,
  sort,
  setSort,
}: {
  title: string;
  subtitle: string;
  sort: SortKey;
  setSort: (v: SortKey) => void;
}) {
  const { t } = useTranslation();
  return (
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
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight truncate">{title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <div className="shrink-0">
          <SortMenu value={sort} onChange={setSort} />
        </div>
      </div>
    </div>
  );
}

export function emptyTitle(tab: string, itemKey: "channel" | "movie" | "series") {
  const item = i18n.t(`empty.${itemKey}`);
  if (tab === "favorites") return i18n.t("empty.noFav", { item });
  if (tab === "recent") return i18n.t("empty.noRecent", { item });
  return i18n.t("empty.noResults");
}
export function emptyHint(tab: string, search: string) {
  if (search) return i18n.t("empty.searchHint", { q: search });
  if (tab === "favorites") return i18n.t("empty.favHint");
  if (tab === "recent") return i18n.t("empty.recentHint");
  return i18n.t("empty.defaultHint");
}
