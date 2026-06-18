import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { Button } from "@/components/ui/button";
import { store, type HistItem } from "@/lib/storage";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Histórico — SoaresTV" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const [items, setItems] = useState<HistItem[]>([]);
  useEffect(() => setItems(store.getHistory()), []);

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Histórico</h1>
        {items.length > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              store.clearHistory();
              setItems([]);
            }}
          >
            Limpar
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground">Você ainda não assistiu nada.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {items.map((it) => (
            <MediaCard key={`${it.type}-${it.id}-${it.at}`} type={it.type} id={it.id} name={it.name} image={it.logo} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
