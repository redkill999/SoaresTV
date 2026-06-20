import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CategorySidebar } from "@/components/CategorySidebar";
import { ParentalGate } from "@/components/ParentalGate";
import { MiniLivePlayer } from "@/components/MiniLivePlayer";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, type LiveCategory, type LiveStream } from "@/lib/xtream";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Heart, Search, Tv, CalendarDays } from "lucide-react";
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
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [cat, setCat] = useState<string>("all");
  const [unlocked, setUnlocked] = useState(false);
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [selected, setSelected] = useState<LiveStream | null>(null);
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
    return list;
  }, [streamsQ.data, deferredSearch, cat, favIds, recentIds]);

  // Auto-select first visible channel when the list changes
  useEffect(() => {
    if (!selected && filtered.length) setSelected(filtered[0]);
    if (selected && !filtered.find((s) => s.stream_id === selected.stream_id) && filtered.length) {
      setSelected(filtered[0]);
    }
  }, [filtered, selected]);

  const parental = store.getParental();
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

  const openFull = (s: LiveStream) => {
    navigate({
      to: "/player/$type/$id",
      params: { type: "live", id: String(s.stream_id) },
      search: { name: s.name },
    });
  };

  return (
    <AppShell search={search} onSearch={setSearch}>
      <Header title={t("pages.live.title")} subtitle={t("pages.live.subtitle")} />

      {/* Mini-player on top */}
      <div className="mb-4">
        <MiniLivePlayer
          creds={creds}
          streamId={selected?.stream_id ?? null}
          name={selected?.name}
          logo={selected?.stream_icon}
        />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
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

        {/* Channel list */}
        <div className="flex-1 min-w-0">
          <div className="rounded-2xl border border-white/10 bg-card/40 backdrop-blur overflow-hidden">
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Search className="size-3.5" />
              <span>{filtered.length} canais</span>
            </div>
            {!creds || streamsQ.isLoading ? (
              <ul className="divide-y divide-white/5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="size-10 rounded-md bg-white/[0.05] animate-pulse shrink-0" />
                    <div className="flex-1 h-3 rounded bg-white/[0.05] animate-pulse" />
                  </li>
                ))}
              </ul>
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <Tv className="size-7 mx-auto mb-2 opacity-50" />
                Nenhum canal encontrado.
              </div>
            ) : (
              <ul className="divide-y divide-white/5 max-h-[60dvh] lg:max-h-[calc(100dvh-26rem)] overflow-y-auto">
                {filtered.map((s) => {
                  const isSel = selected?.stream_id === s.stream_id;
                  const isFav = favIds.has(String(s.stream_id));
                  return (
                    <li key={s.stream_id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (isSel) openFull(s);
                          else setSelected(s);
                        }}
                        onDoubleClick={() => openFull(s)}
                        className={`group w-full text-left flex items-center gap-3 px-3 py-2.5 transition-colors outline-none ${
                          isSel
                            ? "bg-primary/15 border-l-2 border-primary"
                            : "border-l-2 border-transparent hover:bg-white/5 focus-visible:bg-white/5"
                        }`}
                      >
                        {s.stream_icon ? (
                          <img
                            src={s.stream_icon}
                            alt=""
                            loading="lazy"
                            className="size-10 rounded-md object-contain bg-white/5 shrink-0"
                            onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                          />
                        ) : (
                          <div className="size-10 rounded-md bg-white/5 grid place-items-center shrink-0">
                            <Tv className="size-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${isSel ? "text-primary" : ""}`}>
                            {s.name}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            #{s.num}
                          </div>
                        </div>
                        {isFav && <Heart className="size-3.5 fill-primary text-primary shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
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
        <Link
          to="/guide"
          className="shrink-0 inline-flex items-center gap-1.5 h-10 px-3 rounded-full text-sm font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors border border-primary/30"
        >
          <CalendarDays className="size-4" />
          <span className="hidden sm:inline">Guia EPG</span>
        </Link>
      </div>
    </div>
  );
}
