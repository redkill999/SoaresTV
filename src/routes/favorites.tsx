import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MediaCard } from "@/components/MediaCard";
import { store, type FavItem } from "@/lib/storage";

export const Route = createFileRoute("/favorites")({
  head: () => ({ meta: [{ title: "Favoritos — SoaresTV" }] }),
  component: FavoritesPage,
});

function FavoritesPage() {
  const [favs, setFavs] = useState<FavItem[]>([]);
  useEffect(() => {
    setFavs(store.getFavs());
    const i = setInterval(() => setFavs(store.getFavs()), 1000);
    return () => clearInterval(i);
  }, []);

  return (
    <AppShell>
      <h1 className="text-2xl font-bold mb-6">Favoritos</h1>
      {favs.length === 0 ? (
        <p className="text-muted-foreground">Nenhum favorito ainda.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {favs.map((f) => (
            <MediaCard key={`${f.type}-${f.id}`} type={f.type} id={f.id} name={f.name} image={f.logo} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
