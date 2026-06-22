import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { PremiumChrome } from "@/components/PremiumChrome";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { MediaCard } from "@/components/MediaCard";
import { MediaGrid } from "@/components/MediaGrid";
import { type TabKey } from "@/components/SectionTabs";
import { useFavorites } from "@/hooks/use-favorites";
import { store, type HistItem } from "@/lib/storage";
import { ArrowDownAZ, Clock, Flame, Heart } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/favorites")({
  head: () => ({ meta: [{ title: "Favoritos — SoaresTV" }] }),
  component: FavoritesPage,
});

// Critério de ordenação local desta página. "recent" = ordem original (mais
// novo primeiro, como já vem do store.toggleFav); "az" = alfabético;
// "watched" = mais assistidos, cruzando com o histórico.
type SortKey = "recent" | "az" | "watched";

// Hook reativo ao histórico — quando o usuário assiste algo, a contagem
// recalcula sem precisar reabrir a página.
function useHistory(): HistItem[] {
  return useSyncExternalStore(
    (cb) => store.subscribeHistory(cb),
    () => store.getHistory(),
    () => store.getHistory(),
  );
}

function FavoritesPage() {
  const { t } = useTranslation();
  const TABS: { key: TabKey | "live" | "movie" | "series"; label: string }[] = [
    { key: "all", label: t("tabs.all") },
    { key: "live", label: t("nav.channels") },
    { key: "movie", label: t("nav.movies") },
    { key: "series", label: t("nav.series") },
  ];
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"all" | "live" | "movie" | "series">("all");
  const [sort, setSort] = useState<SortKey>(() => {
    if (typeof window === "undefined") return "recent";
    return (localStorage.getItem("soarestv:favSort") as SortKey | null) ?? "recent";
  });
  useEffect(() => {
    try { localStorage.setItem("soarestv:favSort", sort); } catch { /* quota */ }
  }, [sort]);

  const favs = useFavorites();
  const history = useHistory();

  // Contagem de "vezes assistido" por (type, id) — usada apenas no modo
  // "watched". Map é mais barato que filter por item dentro do sort.
  const watchCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of history) {
      const k = `${h.type}:${h.id}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [history]);

  const filtered = useMemo(() => {
    let list = favs;
    if (tab !== "all") list = list.filter((f) => f.type === tab);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(s));
    }
    if (sort === "az") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
    } else if (sort === "watched") {
      list = [...list].sort((a, b) => {
        const ca = watchCount.get(`${a.type}:${a.id}`) ?? 0;
        const cb = watchCount.get(`${b.type}:${b.id}`) ?? 0;
        if (cb !== ca) return cb - ca;
        // empate → mantém ordem de adição (mais recente primeiro)
        return 0;
      });
    }
    // "recent" usa a ordem nativa do store (já é mais novo primeiro).
    return list;
  }, [favs, tab, search, sort, watchCount]);

  const SORT_OPTS: { key: SortKey; label: string; icon: typeof Heart }[] = [
    { key: "recent",  label: "Recentes",       icon: Clock },
    { key: "az",      label: "A–Z",            icon: ArrowDownAZ },
    { key: "watched", label: "Mais assistidos", icon: Flame },
  ];

  return (
    <PremiumChrome title="FAVORITOS">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 pb-3">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-lg sm:text-2xl font-bold tracking-tight truncate">
            {t("pages.favorites.title")}
          </h1>
          <p className="text-xs text-white/60 mt-0.5">{favs.length}</p>
        </div>
        <div className="relative w-44 sm:w-64 shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-white/50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar"
            className="pl-8 bg-white/5 border-white/10 rounded-full h-8 text-xs text-white placeholder:text-white/40"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div role="tablist" className="inline-flex p-1 rounded-full bg-white/[0.05] border border-white/10">
          {TABS.map((tEntry) => {
            const active = tab === tEntry.key;
            const count = tEntry.key === "all" ? favs.length : favs.filter((f) => f.type === tEntry.key).length;
            return (
              <button
                key={tEntry.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(tEntry.key as typeof tab)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                  active
                    ? "bg-gradient-to-r from-red-500 to-blue-600 text-white shadow-[0_0_16px_rgba(220,38,38,0.35)]"
                    : "text-white/65 hover:text-white"
                }`}
              >
                {tEntry.label}
                {count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? "bg-black/25" : "bg-white/[0.08]"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div role="tablist" aria-label="Ordenar favoritos" className="inline-flex p-1 rounded-full bg-white/[0.05] border border-white/10">
          {SORT_OPTS.map((opt) => {
            const active = sort === opt.key;
            const Icon = opt.icon;
            return (
              <button
                key={opt.key}
                role="tab"
                aria-selected={active}
                onClick={() => setSort(opt.key)}
                title={opt.label}
                className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                  active
                    ? "bg-gradient-to-r from-red-500 to-blue-600 text-white shadow-[0_0_16px_rgba(220,38,38,0.35)]"
                    : "text-white/65 hover:text-white"
                }`}
              >
                <Icon className="size-3.5" />
                <span className="hidden sm:inline">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <MediaGrid
        empty={filtered.length === 0}
        aspect={tab === "live" ? "wide" : "poster"}
        emptyIcon={<Heart className="size-7" />}
        emptyTitle={t("empty.noResults")}
        emptyHint={t("empty.favHint")}
      >
        {filtered.map((f) => (
          <MediaCard
            key={`${f.type}-${f.id}`}
            type={f.type}
            id={f.id}
            name={f.name}
            image={f.logo}
            aspect={f.type === "live" ? "wide" : "poster"}
          />
        ))}
      </MediaGrid>
      </div>
    </PremiumChrome>
  );
}
