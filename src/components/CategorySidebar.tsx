import { useMemo, useState, type ReactNode } from "react";
import { Search, Star, Clock, ListFilter } from "lucide-react";

export type CategoryItem = {
  id: string;
  name: string;
  count?: number;
};

export type SidebarSpecial = "all" | "favorites" | "recent";

export function CategorySidebar({
  categories,
  value,
  onChange,
  loading,
  favCount = 0,
  recentCount = 0,
  totalCount = 0,
  header,
}: {
  categories: CategoryItem[];
  value: string; // "all" | "favorites" | "recent" | category_id
  onChange: (v: string) => void;
  loading?: boolean;
  favCount?: number;
  recentCount?: number;
  totalCount?: number;
  header?: ReactNode;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(s));
  }, [q, categories]);

  const specials: { id: SidebarSpecial; label: string; icon: ReactNode; count: number; highlight?: boolean }[] = [
    { id: "favorites", label: "FAVORITOS", icon: <Star className="size-4" />, count: favCount },
    { id: "recent", label: "RECENTES", icon: <Clock className="size-4" />, count: recentCount },
    { id: "all", label: "TODAS", icon: <ListFilter className="size-4" />, count: totalCount, highlight: true },
  ];

  return (
    <>
      {/* Mobile: strip horizontal de chips (não come a tela toda) */}
      <div className="sm:hidden -mx-1">
        <div className="flex gap-2 overflow-x-auto px-1 pb-2 scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {specials.map((s) => (
            <MobileChip
              key={s.id}
              active={value === s.id}
              onClick={() => onChange(s.id)}
              icon={s.icon}
              label={s.label}
              count={s.count}
              highlight={s.highlight}
            />
          ))}
          <span className="shrink-0 self-center h-5 w-px bg-white/10 mx-1" />
          {loading && Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="h-8 w-24 shrink-0 animate-pulse rounded-full bg-white/[0.05]" />
          ))}
          {!loading && categories.map((c) => (
            <MobileChip
              key={c.id}
              active={value === c.id}
              onClick={() => onChange(c.id)}
              label={c.name}
              count={c.count}
            />
          ))}
        </div>
      </div>

      {/* Tablet/Desktop: sidebar vertical clássica */}
      <aside className="hidden sm:flex h-[calc(100dvh-7rem)] w-64 flex-col rounded-2xl border border-white/5 bg-card/40 backdrop-blur lg:w-72">
        {header && <div className="border-b border-white/5 px-3 py-2">{header}</div>}

        <div className="border-b border-white/5 p-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar categoria…"
              className="w-full rounded-md border border-white/5 bg-black/30 pl-8 pr-2 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </label>
        </div>

        <ul className="flex-1 overflow-y-auto py-1">
          {specials.map((s) => (
            <SidebarRow
              key={s.id}
              icon={s.icon}
              active={value === s.id}
              onClick={() => onChange(s.id)}
              label={s.label}
              count={s.count}
              highlight={s.highlight}
            />
          ))}
          <li className="my-1 border-t border-white/5" />
          {loading && Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="px-3 py-2">
              <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.06]" />
            </li>
          ))}
          {!loading && list.map((c) => (
            <SidebarRow
              key={c.id}
              active={value === c.id}
              onClick={() => onChange(c.id)}
              label={c.name}
              count={c.count}
            />
          ))}
        </ul>
      </aside>
    </>
  );
}

function MobileChip({
  active,
  onClick,
  icon,
  label,
  count,
  highlight,
}: {
  active?: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: string;
  count?: number;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 h-9 text-xs font-medium whitespace-nowrap transition ${
        active
          ? "bg-brand-gradient text-primary-foreground border-transparent shadow-glow"
          : highlight
            ? "border-primary/40 text-primary bg-primary/5"
            : "border-white/10 text-muted-foreground bg-white/[0.02] hover:text-foreground hover:border-white/20"
      }`}
    >
      {icon}
      <span className="uppercase tracking-wide">{label}</span>
      {typeof count === "number" && (
        <span className={`text-[10px] ${active ? "text-white/80" : "text-muted-foreground"}`}>({count})</span>
      )}
    </button>
  );
}

function SidebarRow({
  icon,
  label,
  count,
  active,
  onClick,
  highlight,
}: {
  icon?: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition ${
          active
            ? "bg-primary/20 text-primary border-l-2 border-primary"
            : "border-l-2 border-transparent text-foreground/85 hover:bg-white/5"
        } ${highlight && !active ? "text-primary" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate uppercase tracking-wide">{label}</span>
        </span>
        {typeof count === "number" && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            ({count})
          </span>
        )}
      </button>
    </li>
  );
}
