import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDownAZ, ArrowUpZA, ArrowLeft, Search, Tv, X } from "lucide-react";
import type { SortKey } from "@/components/SectionTabs";

export function XciptvHeader({
  sort,
  onSort,
  search,
  onSearch,
  categoryLabel = "CATEGORIES",
  title,
}: {
  sort?: SortKey;
  onSort?: (s: SortKey) => void;
  search?: string;
  onSearch?: (s: string) => void;
  categoryLabel?: string;
  title?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  const time = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const date = now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short", year: "numeric" });

  const cycleSort = () => {
    if (!onSort) return;
    onSort(sort === "az" ? "za" : sort === "za" ? "default" : "az");
  };

  return (
    <header className="relative z-10 grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4 sm:px-6 py-3">
      {/* Left: back + time + date */}
      <div className="min-w-0 flex items-center gap-2 sm:gap-3">
        <Link
          to="/home"
          aria-label="Voltar"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-[#1FB6FF]/55 bg-black/60 px-2.5 text-white shadow-[0_0_18px_rgba(31,182,255,0.22)] transition-all touch-manipulation hover:border-[#1FB6FF] hover:text-[#1FB6FF] active:scale-95 focus:outline-none focus-visible:border-[#1FB6FF] focus-visible:ring-2 focus-visible:ring-[#1FB6FF] sm:h-10 sm:px-3"
        >
          <ArrowLeft className="size-5" />
          <span className="text-[11px] font-bold uppercase tracking-wide">Voltar</span>
        </Link>
        <div className="min-w-0 flex flex-col">
          <div className="font-mono text-base sm:text-lg font-bold text-white leading-tight tracking-wider">
            {time}
          </div>
          <div className="text-[10px] sm:text-xs uppercase tracking-wide text-white/70 truncate">
            {date}
          </div>
        </div>
      </div>

      {/* Center: título opcional (logo removido a pedido) */}
      <div className="shrink-0 grid place-items-center">
        {title && <div className="text-[10px] uppercase tracking-[0.2em] text-white/60">{title}</div>}
      </div>

      {/* Right: controls */}
      <div className="min-w-0 flex items-center justify-end gap-2 sm:gap-4">
        {searchOpen && onSearch ? (
          <div className="flex items-center gap-1 bg-black/40 border border-white/15 rounded-md px-2 h-8">
            <Search className="size-4 text-white/60" />
            <input
              autoFocus
              value={search ?? ""}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar…"
              className="bg-transparent outline-none text-sm text-white placeholder:text-white/40 w-32 sm:w-48"
            />
            <button
              type="button"
              onClick={() => {
                onSearch("");
                setSearchOpen(false);
              }}
              className="text-white/60 hover:text-white tv-hide"
              aria-label="Fechar busca"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : (
          <>
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-xs font-bold text-white tracking-wider">{categoryLabel}</span>
            </div>
            {onSort && (
              <button
                type="button"
                onClick={cycleSort}
                aria-label="Ordenar"
                className="text-white/90 hover:text-[#1FB6FF] transition-colors"
              >
                {sort === "za" ? <ArrowUpZA className="size-6" /> : <ArrowDownAZ className="size-6" />}
              </button>
            )}
            {onSearch && (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label="Buscar"
                className="text-white/90 hover:text-[#1FB6FF] transition-colors"
              >
                <Search className="size-6" />
              </button>
            )}
          </>
        )}
      </div>
    </header>
  );
}
