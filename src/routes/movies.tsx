import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { XciptvHeader } from "@/components/xciptv/XciptvHeader";
import { XciptvCategoryList } from "@/components/xciptv/XciptvCategoryList";
import { XciptvTile } from "@/components/xciptv/XciptvTile";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, type LiveCategory, type VodStream } from "@/lib/xtream";
import { useFavorites, useHistory } from "@/hooks/use-favorites";
import { loadPersisted, withPersist } from "@/lib/query-persist";
import { Film } from "lucide-react";

export const Route = createFileRoute("/movies")({
  head: () => ({ meta: [{ title: "Filmes — SoaresTV" }] }),
  loader: ({ context }) => {
    const creds = store.getCreds();
    if (!creds) return;
    const acct = `${creds.server}|${creds.username}`;
    void context.queryClient.prefetchQuery({
      queryKey: ["vod-cats", acct],
      queryFn: withPersist(`vod-cats:${acct}`, () => api<LiveCategory[]>(creds, "get_vod_categories")),
    });
    void context.queryClient.prefetchQuery({
      queryKey: ["vod-list", acct, "all"],
      queryFn: withPersist(`vod-list:${acct}:all`, () => api<VodStream[]>(creds, "get_vod_streams")),
    });
  },
  component: MoviesPage,
});

function MoviesPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<"az" | "za" | "default">("default");
  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  useEffect(() => setCreds(store.getCreds()), []);

  const acct = creds ? `${creds.server}|${creds.username}` : "";
  const catsCacheKey = `vod-cats:${acct}`;
  const listCacheKey = `vod-list:${acct}:all`;
  const catsPersisted = useMemo(() => (acct ? loadPersisted<LiveCategory[]>(catsCacheKey) : null), [catsCacheKey, acct]);
  const listPersisted = useMemo(() => (acct ? loadPersisted<VodStream[]>(listCacheKey) : null), [listCacheKey, acct]);
  const catsQ = useQuery({
    queryKey: ["vod-cats", acct],
    enabled: !!creds,
    queryFn: withPersist(catsCacheKey, () => api<LiveCategory[]>(creds!, "get_vod_categories")),
    initialData: catsPersisted?.data,
    initialDataUpdatedAt: catsPersisted?.updatedAt,
    staleTime: 10 * 60_000,
  });
  const listQ = useQuery({
    queryKey: ["vod-list", acct, "all"],
    enabled: !!creds,
    queryFn: withPersist(listCacheKey, () => api<VodStream[]>(creds!, "get_vod_streams")),
    initialData: listPersisted?.data,
    initialDataUpdatedAt: listPersisted?.updatedAt,
    staleTime: 10 * 60_000,
  });

  const favs = useFavorites();
  const history = useHistory();
  const favIds = useMemo(() => new Set(favs.filter((f) => f.type === "movie").map((f) => f.id)), [favs]);
  const recentIds = useMemo(() => history.filter((h) => h.type === "movie").map((h) => h.id), [history]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of listQ.data ?? []) {
      const k = String(x.category_id ?? "");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [listQ.data]);

  const sidebarCats = useMemo(
    () => (catsQ.data ?? []).map((c) => ({ id: c.category_id, name: c.category_name, count: counts.get(c.category_id) ?? 0 })),
    [catsQ.data, counts],
  );

  const filtered = useMemo(() => {
    let list = listQ.data ?? [];
    const idOf = (m: VodStream) => `${m.stream_id}.${m.container_extension || "mp4"}`;
    if (cat === "favorites") list = list.filter((m) => favIds.has(idOf(m)));
    else if (cat === "recent") {
      const order = new Map(recentIds.map((id, i) => [id, i]));
      list = list.filter((m) => order.has(idOf(m))).sort((a, b) => order.get(idOf(a))! - order.get(idOf(b))!);
    } else if (cat !== "all") {
      list = list.filter((m) => String(m.category_id) === cat);
    }
    if (deferredSearch) {
      const s = deferredSearch.toLowerCase();
      list = list.filter((x) => x.name.toLowerCase().includes(s));
    }
    if (sort === "az") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "za") list = [...list].sort((a, b) => b.name.localeCompare(a.name));
    return list;
  }, [listQ.data, deferredSearch, sort, cat, favIds, recentIds]);

  return (
    <div className="min-h-dvh xciptv-bg text-white">
      <XciptvHeader sort={sort} onSort={setSort} search={search} onSearch={setSearch} title="MOVIES" />
      <div className="flex flex-col sm:flex-row gap-3 px-3 sm:px-5 pb-6">
        <XciptvCategoryList
          categories={sidebarCats}
          value={cat}
          onChange={setCat}
          loading={!creds || (catsQ.isLoading && !catsQ.data)}
          favCount={favIds.size}
          recentCount={recentIds.length}
          totalCount={listQ.data?.length ?? 0}
        />
        <div className="flex-1 min-w-0">
          {!creds || (listQ.isLoading && filtered.length === 0) ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-sm bg-white/[0.05] animate-pulse" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-white/60">
              <Film className="size-10 mx-auto mb-3 opacity-40" />
              Nenhum filme encontrado.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {filtered.map((m) => (
                <XciptvTile
                  key={m.stream_id}
                  type="movie"
                  id={`${m.stream_id}.${m.container_extension || "mp4"}`}
                  name={m.name}
                  image={m.stream_icon}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
