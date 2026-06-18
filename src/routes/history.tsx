import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { MediaGrid } from "@/components/MediaGrid";
import { Button } from "@/components/ui/button";
import { store } from "@/lib/storage";
import { useHistory } from "@/hooks/use-favorites";
import { History as HistoryIcon } from "lucide-react";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Histórico — SoaresTV" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const items = useHistory();

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6 gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight truncate">
            Histórico
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {items.length} {items.length === 1 ? "item assistido" : "itens assistidos"}
          </p>
        </div>
        {items.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => store.clearHistory()}>
            Limpar
          </Button>
        )}
      </div>

      <MediaGrid
        empty={items.length === 0}
        aspect="poster"
        emptyIcon={<HistoryIcon className="size-7" />}
        emptyTitle="Sem histórico"
        emptyHint="O que você assistir aparece aqui."
      >
        {items.map((it) => (
          <MediaCard
            key={`${it.type}-${it.id}-${it.at}`}
            type={it.type}
            id={it.id}
            name={it.name}
            image={it.logo}
            aspect={it.type === "live" ? "wide" : "poster"}
          />
        ))}
      </MediaGrid>
    </AppShell>
  );
}
