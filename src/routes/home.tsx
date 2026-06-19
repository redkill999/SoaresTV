import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Tv, CalendarDays, Film, Clapperboard,
  User, LayoutGrid, RotateCcw,
  Star, Radio, Settings as SettingsIcon,
  AlarmClock, Video, Lock, Mail, RefreshCw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { store, type M3UPlaylist, type HistItem } from "@/lib/storage";
import { xtreamCredsFromUrl } from "@/lib/xtream";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import homeBg from "@/assets/home-bg.png.asset.json";

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
  { label: "EPG", icon: CalendarDays, to: "/live" },
  { label: "VOD", icon: Film, to: "/movies" },
  { label: "SERIES", icon: Clapperboard, to: "/series" },
];

const BOTTOM_LEFT: Tile[] = [
  { label: "ACCOUNT", icon: User, to: "/settings" },
  { label: "MULTI", icon: LayoutGrid, to: "/live" },
  { label: "CATCH UP", icon: RotateCcw, to: "/live" },
];

const BOTTOM_RIGHT: Tile[] = [
  { label: "FAVORITE", icon: Star, to: "/favorites" },
  { label: "RADIO", icon: Radio, to: "/live" },
  { label: "SETTINGS", icon: SettingsIcon, to: "/settings" },
];

const STATUS = [
  { icon: AlarmClock, label: "ALARM" },
  { icon: Video, label: "REC" },
  { icon: Lock, label: "VPN" },
  { icon: Mail, label: "MSG" },
  { icon: RefreshCw, label: "UPDATE" },
];

type StatusKey = "alarm" | "rec" | "vpn" | "msg" | "update";

function HomePage() {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [m3uList, setM3uList] = useState<M3UPlaylist | null>(null);

  // status state
  const [openStatus, setOpenStatus] = useState<StatusKey | null>(null);
  const [recOn, setRecOn] = useState(false);
  const [alarmMin, setAlarmMin] = useState(0);
  const alarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
    const hasCreds = !!store.getCreds();
    const playlists = store.getM3U();
    setM3uList(playlists[0] ?? null);
    if (!hasCreds && playlists.length === 0) navigate({ to: "/" });
  }, [navigate]);

  // Pinta o "letterbox" do TV-mode com a mesma imagem da home,
  // pra não sobrar barra preta em cima/embaixo no preview.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    const bg = `url(${homeBg.url}) center/cover no-repeat #082968`;
    html.style.background = bg;
    body.style.background = bg;
    return () => {
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
    };
  }, []);

  if (!mounted) return <HomeSkeleton />;

  const openTile = (to: string) => {
    if (!to) return;
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

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#082968] text-white">
      {/* Background image */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${homeBg.url})` }}
      />
      {/* Subtle darken to keep tiles readable */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black/25"
      />


      {/* Top bar */}
      <header className="relative z-10 flex items-start justify-between px-6 pt-5">
        <div className="w-40" />
        <div className="flex flex-col items-center">
          <div className="grid size-14 place-items-center rounded-full bg-white/10 ring-2 ring-white/30 backdrop-blur">
            <Tv className="size-7 text-white" strokeWidth={2.2} />
          </div>
          <div className="mt-1 font-display text-[11px] font-bold tracking-[0.35em] text-white/90">
            SOARES TV
          </div>
        </div>
        <div className="flex w-40 items-start justify-end gap-2.5">
          {STATUS.map((s) => (
            <StatusIcon key={s.label} icon={s.icon} label={s.label} />
          ))}
        </div>
      </header>

      {/* Main 4 tiles */}
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 items-center justify-center px-4">
        <div className="grid w-full grid-cols-2 gap-4 sm:gap-5 md:grid-cols-4">
          {MAIN.map((t) => (
            <MainTile key={t.label} tile={t} onClick={() => openTile(t.to)} />
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 grid grid-cols-3 items-end gap-3 px-4 pb-5 pt-2 sm:px-6">
        <div className="flex items-end gap-2 sm:gap-3">
          {BOTTOM_LEFT.map((t) => (
            <SmallTile key={t.label} tile={t} onClick={() => openTile(t.to)} />
          ))}
        </div>
        <div className="flex flex-col items-center justify-end pb-1 text-center">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/70">
            <Tv className="size-3.5" />
            <span>Developed by</span>
          </div>
          <div className="text-[11px] font-semibold tracking-[0.2em] text-white/90">
            SOARESTV.APP
          </div>
        </div>
        <div className="flex items-end justify-end gap-2 sm:gap-3">
          {BOTTOM_RIGHT.map((t) => (
            <SmallTile key={t.label} tile={t} onClick={() => openTile(t.to)} />
          ))}
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
      className="group flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border-2 border-white/85 bg-white/[0.03] p-4 text-white transition hover:bg-white/10 hover:border-white focus:outline-none focus:ring-2 focus:ring-white/60"
    >
      <Icon className="size-16 sm:size-20 transition group-hover:scale-105" strokeWidth={1.6} />
      <span className="text-lg font-semibold tracking-[0.18em] sm:text-xl">{tile.label}</span>
    </button>
  );
}

function SmallTile({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  const Icon = tile.icon;
  return (
    <button
      onClick={onClick}
      className="flex aspect-square w-[68px] flex-col items-center justify-center gap-1 rounded-lg border border-white/80 bg-white/[0.03] text-white transition hover:bg-white/10 sm:w-[78px]"
    >
      <Icon className="size-6 sm:size-7" strokeWidth={1.7} />
      <span className="text-[9px] font-semibold tracking-widest sm:text-[10px]">{tile.label}</span>
    </button>
  );
}

function StatusIcon({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  label: string;
}) {
  return (
    <div
      title={label}
      className="flex flex-col items-center gap-0.5 text-white/85"
    >
      <Icon className="size-5" strokeWidth={1.8} />
      <span className="text-[8px] font-semibold tracking-wider">{label}</span>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0a3a8c] p-6">
      <div className="mb-8 flex items-center justify-between">
        <Skeleton className="h-10 w-32 bg-white/10" />
        <Skeleton className="h-14 w-14 rounded-full bg-white/10" />
        <Skeleton className="h-10 w-32 bg-white/10" />
      </div>
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-2 items-center gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-2xl bg-white/10" />
        ))}
      </div>
    </div>
  );
}
