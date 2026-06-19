import { Link } from "@tanstack/react-router";
import { Heart, Play, Tv, Film, Clapperboard, ImageOff } from "lucide-react";
import { store, type FavItem } from "@/lib/storage";
import { useIsFavorite } from "@/hooks/use-favorites";
import { useState } from "react";

type Aspect = "poster" | "wide" | "square";

const aspectClass: Record<Aspect, string> = {
  poster: "aspect-[2/3]",
  wide: "aspect-video",
  square: "aspect-square",
};

export function MediaCard({
  type,
  id,
  name,
  image,
  badge,
  aspect = "poster",
  progress,
}: {
  type: FavItem["type"];
  id: string | number;
  name: string;
  image?: string;
  badge?: string;
  aspect?: Aspect;
  /** 0–1: mostra barra de progresso na base da capa (continue assistindo). */
  progress?: number;
}) {
  const idStr = String(id);
  const fav = useIsFavorite(type, idStr);
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const pct =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.max(0, Math.min(1, progress)) * 100
      : null;

  const showImage = !!image && !errored;
  const FallbackIcon = type === "live" ? Tv : type === "movie" ? Film : type === "series" ? Clapperboard : ImageOff;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className="group relative">
      <Link
        to="/player/$type/$id"
        params={{ type, id: idStr }}
        search={{ name }}
        onClick={() => {
          // Sinaliza pro player que deve entrar em tela cheia (somente o vídeo).
          try {
            sessionStorage.setItem("soarestv:autofs", "1");
          } catch {
            /* ignore */
          }
        }}
        className="block"
      >
        <div
          className={`relative ${aspectClass[aspect]} rounded-xl overflow-hidden bg-card/60 shadow-card border border-white/5 group-hover:border-primary/60 group-hover:shadow-glow transition-all`}
        >
          {showImage ? (
            <>
              {!loaded && (
                <div className="absolute inset-0 animate-pulse bg-white/[0.04]" />
              )}
              <img
                src={image}
                alt={name}
                loading="lazy"
                onLoad={() => setLoaded(true)}
                onError={() => {
                  setErrored(true);
                  setLoaded(true);
                }}
                className={`w-full h-full ${
                  aspect === "wide" ? "object-contain p-4" : "object-cover"
                } group-hover:scale-[1.04] transition-transform duration-500`}
              />
            </>
          ) : (
            <div
              className="w-full h-full flex flex-col items-center justify-center gap-2 text-center px-3"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--primary) / 0.18), hsl(var(--accent) / 0.10) 60%, hsl(var(--card) / 0.6))",
              }}
              aria-label={`Sem imagem: ${name}`}
            >
              <FallbackIcon className="size-8 text-primary/80" strokeWidth={1.6} />
              <div className="font-display text-2xl font-bold text-foreground/80 leading-none">
                {initials || name.slice(0, 1).toUpperCase()}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground line-clamp-1">
                {type === "live" ? "Canal" : type === "movie" ? "Filme" : "Série"}
              </div>
            </div>
          )}

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="size-12 rounded-full bg-primary/90 backdrop-blur grid place-items-center shadow-glow">
              <Play className="size-5 text-primary-foreground fill-current" />
            </div>
          </div>

          {badge && (
            <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-brand-gradient text-primary-foreground font-semibold uppercase tracking-wider">
              {badge}
            </span>
          )}

          {pct !== null && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
              <div
                className="h-full bg-brand-gradient shadow-glow"
                style={{ width: `${pct}%` }}
                aria-label={`${Math.round(pct)}% assistido`}
              />
            </div>
          )}
        </div>
      </Link>


      <button
        onClick={(e) => {
          e.preventDefault();
          store.toggleFav({ type, id: idStr, name, logo: image });
        }}
        className="absolute top-2 right-2 size-8 rounded-full bg-black/60 backdrop-blur flex items-center justify-center hover:bg-black/80 transition-colors"
        aria-label="Favoritar"
      >
        <Heart
          className={`size-4 transition-colors ${
            fav ? "fill-primary text-primary" : "text-white"
          }`}
        />
      </button>

      <div className="mt-2 text-sm font-medium line-clamp-2 leading-tight">
        {name}
      </div>
    </div>
  );
}
