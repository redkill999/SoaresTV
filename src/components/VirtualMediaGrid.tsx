import { useRef, useEffect, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Inbox } from "lucide-react";

type Aspect = "poster" | "wide" | "square";

const aspectRatio: Record<Aspect, number> = {
  poster: 2 / 3, // width / height → height = width / ratio
  wide: 16 / 9,
  square: 1,
};

// Responsive column counts matching MediaGrid breakpoints
function colsForWidth(w: number): number {
  if (w >= 1536) return 8; // 2xl
  if (w >= 1280) return 7; // xl
  if (w >= 1024) return 6; // lg
  if (w >= 768) return 5; // md
  if (w >= 640) return 4; // sm
  return 3;
}

function useColumns() {
  const [cols, setCols] = useState(() =>
    typeof window === "undefined" ? 6 : colsForWidth(window.innerWidth),
  );
  useEffect(() => {
    const onResize = () => setCols(colsForWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return cols;
}

export function VirtualMediaGrid<T>({
  items,
  loading,
  empty,
  aspect = "poster",
  emptyTitle = "Nada por aqui",
  emptyHint = "Tente ajustar a busca ou trocar a categoria.",
  emptyIcon,
  renderItem,
  getKey,
  overscan = 4,
}: {
  items: T[];
  loading?: boolean;
  empty?: boolean;
  aspect?: Aspect;
  emptyTitle?: string;
  emptyHint?: string;
  emptyIcon?: ReactNode;
  renderItem: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string | number;
  overscan?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cols = useColumns();
  const [offsetTop, setOffsetTop] = useState(0);
  const [colWidth, setColWidth] = useState(160);

  // Track offset of the container from document top + actual column width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setOffsetTop(rect.top + window.scrollY);
      // gaps: gap-2.5 (10px) below sm, gap-3.5 (14px) at/above sm.
      const isSm = window.innerWidth >= 640;
      const gap = isSm ? 14 : 10;
      const totalGap = gap * (cols - 1);
      setColWidth(Math.max(60, (rect.width - totalGap) / cols));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Scroll handler throttled via rAF — antes lia getBoundingClientRect
    // a cada evento scroll (forced reflow em TV boxes lentos). offsetTop
    // só muda se algo acima do grid mudar de altura, então rAF é o teto certo.
    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; measure(); });
    };
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [cols]);

  const rowCount = Math.ceil(items.length / cols);
  const isSm = typeof window !== "undefined" && window.innerWidth >= 640;
  const gap = isSm ? 14 : 10;
  // Row height: poster cell height + ~36px for title (mt-2 + 2 lines)
  const cellH = colWidth / aspectRatio[aspect];
  const rowHeight = Math.ceil(cellH + 36 + gap);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    overscan,
    scrollMargin: offsetTop,
  });

  if (loading) {
    const skeletonCols = `repeat(${cols}, minmax(0, 1fr))`;
    return (
      <div
        ref={containerRef}
        className="grid gap-2.5 sm:gap-3.5"
        style={{ gridTemplateColumns: skeletonCols }}
      >
        {Array.from({ length: cols * 2 }).map((_, i) => (
          <div key={i}>
            <div
              className="rounded-xl bg-white/[0.04] animate-pulse"
              style={{ aspectRatio: `${aspectRatio[aspect]}` }}
            />
            <div className="mt-2 h-3.5 w-3/4 rounded bg-white/[0.04] animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-20 px-6">
        <div className="size-16 rounded-2xl glass grid place-items-center mb-4 text-muted-foreground">
          {emptyIcon ?? <Inbox className="size-7" />}
        </div>
        <h3 className="font-display font-semibold text-lg">{emptyTitle}</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">{emptyHint}</p>
      </div>
    );
  }

  const totalSize = virtualizer.getTotalSize();
  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: totalSize }}>
      {virtualRows.map((vRow) => {
        const rowStart = vRow.index * cols;
        const rowItems = items.slice(rowStart, rowStart + cols);
        return (
          <div
            key={vRow.key}
            className="absolute left-0 right-0 grid gap-2.5 sm:gap-3.5"
            style={{
              transform: `translateY(${vRow.start - virtualizer.options.scrollMargin}px)`,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            }}
          >
            {rowItems.map((item, i) => (
              <div key={getKey(item, rowStart + i)}>{renderItem(item, rowStart + i)}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
