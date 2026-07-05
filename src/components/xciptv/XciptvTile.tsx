import { Link } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { memo, useState } from "react";
import { store, miniPlayerStore, type FavItem } from "@/lib/storage";
import { useIsFavorite } from "@/hooks/use-favorites";
import channelFallback from "@/assets/channel-fallback.png.asset.json";

// FIX (audit TV): memo evita re-render dos 240 tiles visíveis quando o pai
// (LivePage/LiveGrid) re-renderiza por outro motivo (clock, troca de
// categoria, etc.). Combinado com useIsFavorite granular, um toggle de
// favorito agora re-renderiza só o tile afetado.
export const XciptvTile = memo(function XciptvTile({

  type,
  id,
  name,
  image,
  progress,
  src,
}: {
  type: FavItem["type"];
  id: string;
  name: string;
  image?: string;
  /** 0–1: mostra barra fina de "continue assistindo" na base do tile. */
  progress?: number;
  /** URL real do stream (vinda da M3U) — preservada quando disponível. */
  src?: string;
}) {
  const fav = useIsFavorite(type, id);
  const [errored, setErrored] = useState(false);
  const hasImage = !!image && !errored;
  // Só propaga src real (M3U) — string http(s) com comprimento válido.
  // Se ausente, o player usa o fallback controlado streamUrl.live(creds, id).
  const validSrc = typeof src === "string" && src.length > 10 ? src : undefined;
  const pct =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.max(0, Math.min(1, progress)) * 100
      : null;

  return (
    <Link
      to="/player/$type/$id"
      params={{ type, id }}
      search={type === "live" && validSrc ? { name, src: validSrc } : { name }}
      onClick={() => {
        if (type === "live") miniPlayerStore.set({ streamId: id, name, logo: image, src: validSrc });
      }}
      className="group block focus:outline-none"
    >
      <div className="xciptv-tile rounded-sm overflow-hidden aspect-square relative group-hover:xciptv-tile-active group-focus-visible:xciptv-tile-active">
        {hasImage ? (
          <img
            src={image}
            alt={name}
            loading="lazy"
            onError={() => setErrored(true)}
            className="w-full h-full object-contain p-3"
          />
        ) : (
          <img
            src={channelFallback.url}
            alt={name}
            loading="lazy"
            className="w-full h-full object-contain p-3 opacity-90"
          />
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
          {pct !== null && pct > 0 && (
            <div className="mt-1 h-1 rounded bg-white/10 overflow-hidden">
              <div className="h-full bg-brand-gradient" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>
    </Link>
  );
});

