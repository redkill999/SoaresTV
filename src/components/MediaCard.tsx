import { Link } from "@tanstack/react-router";
import { Heart, Play } from "lucide-react";
import { store, type FavItem } from "@/lib/storage";
import { useState } from "react";

export function MediaCard({
  type,
  id,
  name,
  image,
  badge,
}: {
  type: FavItem["type"];
  id: string | number;
  name: string;
  image?: string;
  badge?: string;
}) {
  const idStr = String(id);
  const [fav, setFav] = useState(() => store.isFav(type, idStr));

  return (
    <div className="group relative">
      <Link
        to="/player/$type/$id"
        params={{ type, id: idStr }}
        search={{ name }}
        className="block"
      >
        <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-card shadow-card border border-white/5 group-hover:border-primary/50 group-hover:shadow-glow transition-all">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={name}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              onError={(e) => ((e.currentTarget.style.opacity = "0.2"))}
            />
          ) : (
            <div className="w-full h-full bg-brand-gradient/30 flex items-center justify-center text-3xl font-bold opacity-50">
              {name.slice(0, 1)}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
            <Play className="size-10 text-white drop-shadow-lg mx-auto" />
          </div>
          {badge && (
            <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-brand-gradient text-primary-foreground font-medium">
              {badge}
            </span>
          )}
        </div>
      </Link>
      <button
        onClick={(e) => {
          e.preventDefault();
          store.toggleFav({ type, id: idStr, name, logo: image });
          setFav((f) => !f);
        }}
        className="absolute top-2 right-2 size-8 rounded-full bg-black/60 backdrop-blur flex items-center justify-center hover:bg-black/80"
        aria-label="Favoritar"
      >
        <Heart className={`size-4 ${fav ? "fill-primary text-primary" : "text-white"}`} />
      </button>
      <div className="mt-2 text-sm font-medium line-clamp-2">{name}</div>
    </div>
  );
}
