import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { MediaGrid } from "@/components/MediaGrid";
import { SectionTabs, type TabKey } from "@/components/SectionTabs";
import { useFavorites } from "@/hooks/use-favorites";
import { Heart } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/favorites")({
  head: () => ({ meta: [{ title: "Favoritos — SoaresTV" }] }),
  component: FavoritesPage,
});

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
  const favs = useFavorites();

  const filtered = useMemo(() => {
    let list = favs;
    if (tab !== "all") list = list.filter((f) => f.type === tab);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(s));
    }
    return list;
  }, [favs, tab, search]);

  return (
    <AppShell search={search} onSearch={setSearch}>
      <div className="mb-5">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
          {t("pages.favorites.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {favs.length}
        </p>
      </div>

      <div role="tablist" className="inline-flex p-1 rounded-full glass border border-border/60 mb-5">
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = t.key === "all" ? favs.length : favs.filter((f) => f.type === t.key).length;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key as typeof tab)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                active
                  ? "bg-brand-gradient text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? "bg-black/20" : "bg-white/[0.06]"}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <MediaGrid
        empty={filtered.length === 0}
        aspect={tab === "live" ? "wide" : "poster"}
        emptyIcon={<Heart className="size-7" />}
        emptyTitle="Nenhum favorito ainda"
        emptyHint="Toque no coração nos cards para salvar aqui."
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
    </AppShell>
  );
}
