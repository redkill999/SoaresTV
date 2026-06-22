import { Link } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { useState } from "react";
import { store, type FavItem } from "@/lib/storage";
import { useIsFavorite } from "@/hooks/use-favorites";
import channelFallback from "@/assets/channel-fallback.png.asset.json";

export function XciptvTile({
  type,
  id,
  name,
  image,
}: {
  type: FavItem["type"];
  id: string;
  name: string;
  image?: string;
}) {
  const fav = useIsFavorite(type, id);
  const [errored, setErrored] = useState(false);
  const Fallback = type === "live" ? Tv : type === "movie" ? Film : Clapperboard;

  return (
    <Link
      to="/player/$type/$id"
      params={{ type, id }}
      search={{ name }}
      className="group block focus:outline-none"
    >
      <div className="xciptv-tile rounded-sm overflow-hidden aspect-square relative group-hover:xciptv-tile-active group-focus-visible:xciptv-tile-active">
        {image && !errored ? (
          <img
            src={image}
            alt={name}
            loading="lazy"
            onError={() => setErrored(true)}
            className="w-full h-full object-contain p-3"
          />
        ) : (
          <div className="w-full h-full grid place-items-center">
            <Fallback className="size-10 text-white/30" strokeWidth={1.5} />
          </div>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            store.toggleFav({ type, id, name, logo: image });
          }}
          className="absolute top-1 right-1 size-6 rounded-full bg-black/60 grid place-items-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
          aria-label={fav ? "Remover favorito" : "Adicionar favorito"}
        >
          <Heart className={`size-3 ${fav ? "fill-[#1FB6FF] text-[#1FB6FF]" : "text-white"}`} />
        </button>

        {/* Name strip overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-black/85 px-1.5 py-1 text-center">
          <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wide text-white leading-tight line-clamp-2">
            {name}
          </div>
        </div>
      </div>
    </Link>
  );
}
