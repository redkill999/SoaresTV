import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import {
  Tv, CalendarDays, Film, Clapperboard, User, LayoutGrid,
  RotateCcw, Heart, Radio, Settings as SettingsIcon,
  Circle, ShieldCheck, Lock, MessageSquare, RefreshCw,
} from "lucide-react";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { Skeleton } from "@/components/ui/skeleton";
import { store } from "@/lib/storage";

export const Route = createFileRoute("/home")({
  component: HomePage,
});

type Tile = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  to: string;
  hint?: string;
};

const MAIN: Tile[] = [
  { label: "LIVE TV", icon: Tv, to: "/live", hint: "Canais ao vivo" },
  { label: "EPG", icon: CalendarDays, to: "/live", hint: "Guia de programação" },
  { label: "VOD", icon: Film, to: "/movies", hint: "Filmes sob demanda" },
  { label: "SÉRIES", icon: Clapperboard, to: "/series", hint: "Episódios e temporadas" },
];

const BOTTOM_LEFT: Tile[] = [
  { label: "CONTA", icon: User, to: "/settings" },
  { label: "MULTI", icon: LayoutGrid, to: "/live" },
  { label: "CATCH UP", icon: RotateCcw, to: "/live" },
];

const BOTTOM_RIGHT: Tile[] = [
  { label: "FAVORITOS", icon: Heart, to: "/favorites" },
  { label: "RÁDIO", icon: Radio, to: "/live" },
  { label: "AJUSTES", icon: SettingsIcon, to: "/settings" },
];

function HomePage() {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!store.getCreds()) navigate({ to: "/" });
  }, [navigate]);

  if (!mounted) return <HomeSkeleton />;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(800px 400px at 20% 10%, hsl(var(--primary) / 0.18), transparent 60%), radial-gradient(700px 380px at 80% 90%, hsl(var(--accent) / 0.15), transparent 60%)",
        }}
      />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="w-32" />
        <h1 className="text-2xl font-bold tracking-[0.3em] text-primary">
          SOARES <span className="text-foreground">TV</span>
        </h1>
        <div className="flex items-center gap-3">
          <StatusIcon icon={Circle} label="REC" />
          <StatusIcon icon={ShieldCheck} label="PARENTAL" />
          <StatusIcon icon={Lock} label="VPN" />
          <StatusIcon icon={MessageSquare} label="MSG" />
          <StatusIcon icon={RefreshCw} label="UPDATE" />
          <ThemeSwitcher />
        </div>
      </header>

      {/* Main grid */}
      <main className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 gap-5 px-6 pt-4 md:grid-cols-2">
        {MAIN.map((t) => (
          <BigTile key={t.label} tile={t} onClick={() => navigate({ to: t.to })} />
        ))}
      </main>

      {/* Footer rows */}
      <footer className="relative z-10 mx-auto mt-8 grid max-w-6xl grid-cols-2 gap-5 px-6 pb-8">
        <div className="grid grid-cols-3 gap-3">
          {BOTTOM_LEFT.map((t) => (
            <SmallTile key={t.label} tile={t} onClick={() => navigate({ to: t.to })} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {BOTTOM_RIGHT.map((t) => (
            <SmallTile key={t.label} tile={t} onClick={() => navigate({ to: t.to })} />
          ))}
        </div>
      </footer>
    </div>
  );
}

function BigTile({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  const Icon = tile.icon;
  return (
    <button
      onClick={onClick}
      className="group flex h-40 items-center justify-between rounded-2xl border border-border bg-card/40 px-8 text-left backdrop-blur transition hover:border-primary/70 hover:bg-card/60 hover:shadow-[0_0_40px_-10px_hsl(var(--primary)/0.5)]"
    >
      <div>
        <div className="text-3xl font-bold tracking-wider text-foreground">{tile.label}</div>
        {tile.hint && <div className="mt-1 text-sm text-muted-foreground">{tile.hint}</div>}
      </div>
      <Icon className="h-16 w-16 text-primary transition group-hover:scale-110" />
    </button>
  );
}

function SmallTile({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  const Icon = tile.icon;
  return (
    <button
      onClick={onClick}
      className="flex h-20 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card/40 backdrop-blur transition hover:border-primary/70 hover:bg-card/60"
    >
      <Icon className="h-6 w-6 text-primary" />
      <span className="text-xs font-semibold tracking-widest text-foreground">{tile.label}</span>
    </button>
  );
}

function StatusIcon({ icon: Icon, label }: { icon: ComponentType<{ className?: string }>; label: string }) {
  return (
    <div
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/40 text-muted-foreground"
    >
      <Icon className="h-4 w-4" />
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background p-6">
      <div className="mb-8 flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-5 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
      <div className="mx-auto mt-8 grid max-w-6xl grid-cols-2 gap-5">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
