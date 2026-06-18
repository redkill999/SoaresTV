import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { MediaGrid } from "@/components/MediaGrid";
import { CatChip, SectionTabs, SortMenu, type SortKey, type TabKey } from "@/components/SectionTabs";
import { ParentalGate } from "@/components/ParentalGate";
import { store } from "@/lib/storage";
import { api, type LiveCategory, type LiveStream } from "@/lib/xtream";
import { ArrowLeft, Tv } from "lucide-react";
import { useFavorites, useHistory } from "@/hooks/use-favorites";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Ao Vivo — SoaresTV" }] }),
  component: LivePage,
});

function LivePage() {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [tab, setTab] = useState<TabKey>("all");
  const [sort, setSort] = useState<SortKey>("default");
  const [unlocked, setUnlocked] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const creds = mounted ? store.getCreds() : null;

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

  const needGate = cat !== "all";
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
        title="Canais ao Vivo"
        subtitle="Transmissão em tempo real"
        tab={tab}
        setTab={setTab}
        sort={sort}
        setSort={setSort}
        counts={{ favorites: favIds.size, recent: recentIds.length }}
      />

      <div className="flex gap-2 overflow-x-auto pb-3 mb-5 -mx-1 px-1 scrollbar-thin">
        <CatChip active={cat === "all"} onClick={() => setCat("all")}>
          Todas categorias
        </CatChip>
        {(categoriesQ.data ?? []).map((c) => (
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
        ))}
      </div>

      <MediaGrid
        loading={streamsQ.isLoading}
        empty={!streamsQ.isLoading && filtered.length === 0}
        aspect="wide"
        emptyIcon={<Tv className="size-7" />}
        emptyTitle={emptyTitle(tab, "canal")}
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
  return (
    <div className="mb-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 mb-4">
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

export function emptyTitle(tab: TabKey, item: string) {
  if (tab === "favorites") return `Nenhum ${item} favorito`;
  if (tab === "recent") return `Nenhum ${item} recente`;
  return "Nada encontrado";
}
export function emptyHint(tab: TabKey, search: string) {
  if (search) return `Sem resultados para "${search}".`;
  if (tab === "favorites") return "Toque no coração nos cards para favoritar.";
  if (tab === "recent") return "O que você assistir aparece aqui.";
  return "Tente ajustar a busca ou trocar a categoria.";
}
