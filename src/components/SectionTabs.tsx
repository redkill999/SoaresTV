export type TabKey = "all" | "favorites" | "recent";

export function SectionTabs({
  value,
  onChange,
  counts,
}: {
  value: TabKey;
  onChange: (v: TabKey) => void;
  counts?: Partial<Record<TabKey, number>>;
}) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "favorites", label: "Favoritos" },
    { key: "recent", label: "Recentes" },
  ];

  return (
    <div
      role="tablist"
      className="inline-flex p-1 rounded-full glass border border-border/60"
    >
      {tabs.map((t) => {
        const active = value === t.key;
        const count = counts?.[t.key];
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              active
                ? "bg-brand-gradient text-primary-foreground shadow-glow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {typeof count === "number" && count > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  active ? "bg-black/20" : "bg-white/[0.06]"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function CatChip({
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
      className={`px-3.5 py-1.5 rounded-full text-xs whitespace-nowrap border transition shrink-0 ${
        active
          ? "bg-brand-gradient text-primary-foreground border-transparent shadow-glow font-medium"
          : "border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20 bg-white/[0.02]"
      }`}
    >
      {children}
    </button>
  );
}

export function CatChipsSkeleton({ count = 8 }: { count?: number }) {
  const widths = ["w-20", "w-28", "w-24", "w-32", "w-20", "w-28", "w-24", "w-28"];
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          className={`h-7 ${widths[i % widths.length]} rounded-full bg-white/[0.04] animate-pulse shrink-0`}
        />
      ))}
    </>
  );
}

export type SortKey = "default" | "az" | "za";

export function SortMenu({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
}) {
  const opts: { key: SortKey; label: string }[] = [
    { key: "default", label: "Padrão" },
    { key: "az", label: "A → Z" },
    { key: "za", label: "Z → A" },
  ];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
      className="text-xs bg-white/5 border border-white/10 rounded-full px-3 py-1.5 hover:bg-white/10 transition-colors cursor-pointer"
      aria-label="Ordenar"
    >
      {opts.map((o) => (
        <option key={o.key} value={o.key} className="bg-card">
          {o.label}
        </option>
      ))}
    </select>
  );
}
