import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ParentalGate } from "@/components/ParentalGate";
import { XciptvHeader } from "@/components/xciptv/XciptvHeader";
import { XciptvCategoryList } from "@/components/xciptv/XciptvCategoryList";
import { XciptvTile } from "@/components/xciptv/XciptvTile";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, type LiveCategory, type LiveStream } from "@/lib/xtream";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { Tv } from "lucide-react";

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
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [cat, setCat] = useState<string>("all");
  const [sort, setSort] = useState<"az" | "za" | "default">("default");
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
  const favIds = useMemo(() => new Set(favs.filter((f) => f.type === "live").map((f) => f.id)), [favs]);
  const recentIds = useMemo(() => history.filter((h) => h.type === "live").map((h) => h.id), [history]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of streamsQ.data ?? []) {
      const k = String(s.category_id ?? "");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [streamsQ.data]);

  const sidebarCats = useMemo(
    () => (categoriesQ.data ?? []).map((c) => ({ id: c.category_id, name: c.category_name, count: counts.get(c.category_id) ?? 0 })),
    [categoriesQ.data, counts],
  );

  const filtered = useMemo(() => {
    let list = streamsQ.data ?? [];
    if (cat === "favorites") list = list.filter((x) => favIds.has(String(x.stream_id)));
    else if (cat === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list.filter((x) => order.has(String(x.stream_id))).sort((a, b) => order.get(String(a.stream_id))! - order.get(String(b.stream_id))!);
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
  }, [streamsQ.data, deferredSearch, cat, favIds, recentIds, sort]);

  const parental = store.getParental();
  const needGate = cat !== "all" && cat !== "favorites" && cat !== "recent" && !!parental.pin && parental.lockedCategories.includes(cat);

  return (
    <AppShell><div className="-m-4 sm:-m-6 min-h-[calc(100dvh-3rem)] xciptv-bg text-white">
      <XciptvHeader sort={sort} onSort={setSort} search={search} onSearch={setSearch} title="LIVE TV" />
      {needGate && !unlocked ? (
        <div className="px-6"><ParentalGate categoryId={cat} onUnlock={() => setUnlocked(true)} /></div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3 px-3 sm:px-5 pb-6">
          <XciptvCategoryList
            categories={sidebarCats}
            value={cat}
            onChange={(v) => { setCat(v); setUnlocked(false); }}
            loading={!creds || (categoriesQ.isLoading && !categoriesQ.data)}
            favCount={favIds.size}
            recentCount={recentIds.length}
            totalCount={streamsQ.data?.length ?? 0}
          />
          <div className="flex-1 min-w-0 max-h-[calc(100dvh-10rem)] overflow-y-auto pr-1">
            {!creds || streamsQ.isLoading ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                {Array.from({ length: 18 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-sm bg-white/[0.05] animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-white/60">
                <Tv className="size-10 mx-auto mb-3 opacity-40" />
                Nenhum canal encontrado.
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                {filtered.map((s) => (
                  <XciptvTile
                    key={s.stream_id}
                    type="live"
                    id={String(s.stream_id)}
                    name={s.name}
                    image={s.stream_icon}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div></AppShell>
  );
}
