import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { store, type XtreamCreds } from "@/lib/storage";
import { api, type LiveCategory, type Series, xtreamCredsFromUrl } from "@/lib/xtream";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/series")({
  head: () => ({ meta: [{ title: "Séries — SoaresTV" }] }),
  component: SeriesPage,
});

function SeriesPage() {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [creds, setCreds] = useState<XtreamCreds | null>(null);

  useEffect(() => {
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

  const catsQ = useQuery({
    queryKey: ["series-cats"],
    enabled: !!creds,
    queryFn: () => api<LiveCategory[]>(creds!, "get_series_categories"),
  });
  const listQ = useQuery({
    queryKey: ["series-list", cat],
    enabled: !!creds,
    queryFn: () =>
      api<Series[]>(creds!, "get_series", cat !== "all" ? { category_id: cat } : undefined),
  });

  const filtered = useMemo(() => {
    const list = listQ.data ?? [];
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter((x) => x.name.toLowerCase().includes(s));
  }, [listQ.data, search]);

  return (
    <AppShell search={search} onSearch={setSearch}>
      <h1 className="text-2xl font-bold mb-4">Séries</h1>
      <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
        <Chip active={cat === "all"} onClick={() => setCat("all")}>
          Todos
        </Chip>
        {(catsQ.data ?? []).map((c) => (
          <Chip key={c.category_id} active={cat === c.category_id} onClick={() => setCat(c.category_id)}>
            {c.category_name}
          </Chip>
        ))}
      </div>
      {listQ.isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filtered.map((s) => (
            <Link
              key={s.series_id}
              to="/player/$type/$id"
              params={{ type: "series", id: String(s.series_id) }}
              search={{ name: s.name }}
              className="contents"
            >
              <MediaCard type="series" id={s.series_id} name={s.name} image={s.cover} />
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-full text-xs whitespace-nowrap border transition ${
        active
          ? "bg-brand-gradient text-primary-foreground border-transparent shadow-glow"
          : "border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20"
      }`}
    >
      {children}
    </button>
  );
}
