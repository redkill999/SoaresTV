import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { ParentalGate } from "@/components/ParentalGate";
import { store } from "@/lib/storage";
import { api, type LiveCategory, type LiveStream } from "@/lib/xtream";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Ao Vivo — SoaresTV" }] }),
  component: LivePage,
});

function LivePage() {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [unlocked, setUnlocked] = useState(false);

  const creds = typeof window !== "undefined" ? store.getCreds() : null;

  const categoriesQ = useQuery({
    queryKey: ["live-cats"],
    enabled: !!creds,
    queryFn: () => api<LiveCategory[]>(creds!, "get_live_categories"),
  });
  const streamsQ = useQuery({
    queryKey: ["live-streams", cat],
    enabled: !!creds,
    queryFn: () =>
      api<LiveStream[]>(
        creds!,
        "get_live_streams",
        cat !== "all" ? { category_id: cat } : undefined,
      ),
  });

  const filtered = useMemo(() => {
    const list = streamsQ.data ?? [];
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter((x) => x.name.toLowerCase().includes(s));
  }, [streamsQ.data, search]);

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
      <h1 className="text-2xl font-bold mb-4">Canais ao Vivo</h1>

      <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
        <CatChip active={cat === "all"} onClick={() => setCat("all")}>
          Todos
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

      {streamsQ.isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filtered.map((s) => (
            <MediaCard
              key={s.stream_id}
              type="live"
              id={s.stream_id}
              name={s.name}
              image={s.stream_icon}
              badge="LIVE"
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function CatChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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
