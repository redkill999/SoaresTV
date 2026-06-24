import { memo, useMemo, useState } from "react";
import { Search, Star, Clock, ListFilter } from "lucide-react";

export type XciptvCat = { id: string; name: string; count?: number };

// FIX (audit TV): memo evita re-render desta lista quando o pai re-renderiza
// por outro motivo (toggle de favorito, etc.). 'specials' agora memoizado.
export const XciptvCategoryList = memo(function XciptvCategoryList({

  categories,
  value,
  onChange,
  loading,
  favCount = 0,
  recentCount = 0,
  totalCount = 0,
}: {
  categories: XciptvCat[];
  value: string;
  onChange: (v: string) => void;
  loading?: boolean;
  favCount?: number;
  recentCount?: number;
  totalCount?: number;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(s));
  }, [q, categories]);

  const specials = useMemo(() => [
    { id: "favorites", label: "FAVORITOS", count: favCount, icon: <Star className="size-3.5" /> },
    { id: "recent", label: "RECENTES", count: recentCount, icon: <Clock className="size-3.5" /> },
    { id: "all", label: "TODAS", count: totalCount, icon: <ListFilter className="size-3.5" /> },
  ], [favCount, recentCount, totalCount]);


  return (
    <aside className="w-full sm:h-full sm:w-56 lg:w-64 shrink-0 flex flex-col max-h-[34dvh] sm:max-h-none min-h-0">
      <div className="px-2 pb-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-white/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="BUSCAR CATEGORIA"
            className="w-full bg-black/30 border border-white/10 rounded-sm pl-7 pr-2 py-1.5 text-[11px] uppercase tracking-wide text-white placeholder:text-white/30 focus:outline-none focus:border-[#1FB6FF]"
          />
        </label>
      </div>

      <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 [-webkit-overflow-scrolling:touch]">
        {specials.map((s) => (
          <Row key={s.id} active={value === s.id} onClick={() => onChange(s.id)} label={s.label} count={s.count} icon={s.icon} />
        ))}
        <li className="my-1 border-t border-white/10" />
        {loading && Array.from({ length: 10 }).map((_, i) => (
          <li key={i} className="px-3 py-1.5"><div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.08]" /></li>
        ))}
        {!loading && list.map((c) => (
          <Row key={c.id} active={value === c.id} onClick={() => onChange(c.id)} label={c.name} count={c.count} />
        ))}
      </ul>
    </aside>
  );
}

function Row({ active, onClick, label, count, icon }: { active?: boolean; onClick: () => void; label: string; count?: number; icon?: React.ReactNode }) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] font-semibold uppercase tracking-wider transition-colors ${
          active
            ? "text-[#1FB6FF] bg-white/[0.04]"
            : "text-white/85 hover:text-white hover:bg-white/[0.03]"
        }`}
      >
        {icon}
        <span className="truncate flex-1">{label}</span>
        {typeof count === "number" && (
          <span className={`text-[11px] font-normal ${active ? "text-[#1FB6FF]/80" : "text-white/50"}`}>
            ({count})
          </span>
        )}
      </button>
    </li>
  );
}
