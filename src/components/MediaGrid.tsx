import { type ReactNode } from "react";
import { Inbox } from "lucide-react";

type Aspect = "poster" | "wide" | "square";

const aspectClass: Record<Aspect, string> = {
  poster: "aspect-[2/3]",
  wide: "aspect-video",
  square: "aspect-square",
};

const gridCols =
  "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4";

export function MediaGrid({
  loading,
  empty,
  children,
  aspect = "poster",
  emptyTitle = "Nada por aqui",
  emptyHint = "Tente ajustar a busca ou trocar a categoria.",
  emptyIcon,
}: {
  loading?: boolean;
  empty?: boolean;
  children: ReactNode;
  aspect?: Aspect;
  emptyTitle?: string;
  emptyHint?: string;
  emptyIcon?: ReactNode;
}) {
  if (loading) {
    return (
      <div className={gridCols}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i}>
            <div
              className={`${aspectClass[aspect]} rounded-xl bg-white/[0.04] animate-pulse`}
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
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">
          {emptyHint}
        </p>
      </div>
    );
  }

  return <div className={gridCols}>{children}</div>;
}
