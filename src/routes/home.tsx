import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import {
  Tv, Film, Clapperboard, CalendarDays,
  User, Heart, Radio, RotateCcw, LayoutGrid,
  Settings as SettingsIcon, RefreshCw, Power, Wifi,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { store, type M3UPlaylist } from "@/lib/storage";
import { xtreamCredsFromUrl } from "@/lib/xtream";

export const Route = createFileRoute("/home")({
  component: HomePage,
});

type Tile = {
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  to: string;
};

const MAIN: Tile[] = [
  { label: "LIVE TV", icon: Tv, to: "/live" },
  { label: "FILMES", icon: Film, to: "/movies" },
  { label: "SÉRIES", icon: Clapperboard, to: "/series" },
  { label: "EPG", icon: CalendarDays, to: "/live" },
];

const ACTIONS: Tile[] = [
  { label: "Favoritos", icon: Heart, to: "/favorites" },
  { label: "Catch Up", icon: RotateCcw, to: "/live" },
  { label: "Multi", icon: LayoutGrid, to: "/live" },
  { label: "Rádio", icon: Radio, to: "/live" },
  { label: "Conta", icon: User, to: "/settings" },
  { label: "Ajustes", icon: SettingsIcon, to: "/settings" },
];

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(id);
  }, []);
  return now;
}

function HomePage() {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [m3uList, setM3uList] = useState<M3UPlaylist | null>(null);
  const now = useClock();

  useEffect(() => {
    setMounted(true);
    const hasCreds = !!store.getCreds();
    const playlists = store.getM3U();
    const hasM3U = playlists.length > 0;
    setM3uList(playlists[0] ?? null);
    if (!hasCreds && !hasM3U) navigate({ to: "/" });
  }, [navigate]);

  if (!mounted) return <HomeSkeleton />;

  const openTile = (to: string) => {
    const usesPlaylistContent = to === "/live" || to === "/movies" || to === "/series";
    if (m3uList && !store.getCreds() && usesPlaylistContent) {
      const xtreamCreds = xtreamCredsFromUrl(m3uList.url, m3uList.username, m3uList.password);
      if (xtreamCreds) {
        store.setCreds(xtreamCreds);
        navigate({ to });
        return;
      }
      navigate({ to: "/playlist", search: { url: m3uList.url, name: m3uList.name } });
      return;
    }
    navigate({ to });
  };

  const logout = () => {
    store.setCreds(null);
    navigate({ to: "/" });
  };

  const timeStr = now
    ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--:--";
  const dateStr = now
    ? now.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" })
    : "";

  return (
    <div className="flex min-h-dvh flex-col bg-[#0b0e13] text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-white/5 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-md bg-primary/15 text-primary">
            <Tv className="size-5" strokeWidth={2.25} />
          </div>
          <div className="leading-tight">
            <div className="font-display text-sm font-semibold tracking-wide">SoaresTV</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              IPTV Player
            </div>
          </div>
        </div>

        <div className="text-center leading-tight">
          <div className="font-mono text-2xl font-semibold tabular-nums">{timeStr}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{dateStr}</div>
        </div>

        <div className="flex items-center gap-2 text-muted-foreground">
          <Wifi className="size-4" />
          <span className="text-[11px] uppercase tracking-widest">Online</span>
        </div>
      </header>

      {/* Main tiles */}
      <main className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-2 gap-4 px-6 py-8 sm:gap-6 sm:py-12">
        {MAIN.map((t) => (
          <MainTile key={t.label} tile={t} onClick={() => openTile(t.to)} />
        ))}
      </main>

      {/* Footer action bar */}
      <footer className="border-t border-white/5 bg-black/30 px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-2 sm:gap-3">
          {ACTIONS.map((a) => (
            <ActionButton key={a.label} tile={a} onClick={() => openTile(a.to)} />
          ))}
          <ActionButton
            tile={{ label: "Atualizar", icon: RefreshCw, to: "" }}
            onClick={() => window.location.reload()}
          />
          <ActionButton
            tile={{ label: "Sair", icon: Power, to: "" }}
            onClick={logout}
          />
        </div>
      </footer>
    </div>
  );
}

function MainTile({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  const Icon = tile.icon;
  return (
    <button
      onClick={onClick}
      className="group flex aspect-[16/10] flex-col items-center justify-center gap-3 rounded-xl border border-white/5 bg-[#141821] text-foreground transition hover:border-primary/50 hover:bg-[#1a1f2b] focus:outline-none focus:ring-2 focus:ring-primary/60"
    >
      <Icon className="size-12 text-primary transition group-hover:scale-110 sm:size-16" strokeWidth={1.6} />
      <span className="text-sm font-semibold tracking-[0.25em] text-foreground sm:text-base">
        {tile.label}
      </span>
    </button>
  );
}

function ActionButton({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  const Icon = tile.icon;
  return (
    <button
      onClick={onClick}
      className="flex min-w-[72px] flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 text-muted-foreground transition hover:bg-white/5 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <Icon className="size-5" />
      <span className="text-[10px] font-medium uppercase tracking-wider">{tile.label}</span>
    </button>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0b0e13] p-6">
      <div className="mb-8 flex items-center justify-between">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-24" />
      </div>
      <div className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[16/10] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
