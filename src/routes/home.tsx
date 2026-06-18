import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Tv,
  CalendarRange,
  Film,
  Clapperboard,
  User2,
  LayoutGrid,
  History,
  Star,
  Radio,
  Settings,
  AlarmClock,
  Shield,
  Lock,
  Mail,
  RefreshCw,
  PlayCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export const Route = createFileRoute("/home")({
  head: () => ({ meta: [{ title: "Início — SoaresTV" }] }),
  component: HomePage,
});

type Tile = { label: string; icon: LucideIcon; to: string };

function HomePage() {
  const navigate = useNavigate();

  const main: Tile[] = [
    { label: "LIVE TV", icon: Tv, to: "/live" },
    { label: "EPG", icon: CalendarRange, to: "/live" },
    { label: "VOD", icon: Film, to: "/movies" },
    { label: "SÉRIES", icon: Clapperboard, to: "/series" },
  ];

  const bottomLeft: Tile[] = [
    { label: "CONTA", icon: User2, to: "/settings" },
    { label: "MULTI", icon: LayoutGrid, to: "/live" },
    { label: "CATCH UP", icon: History, to: "/history" },
  ];

  const bottomRight: Tile[] = [
    { label: "FAVORITOS", icon: Star, to: "/favorites" },
    { label: "RÁDIO", icon: Radio, to: "/live" },
    { label: "AJUSTES", icon: Settings, to: "/settings" },
  ];

  const topIcons: Array<{ icon: LucideIcon; label: string }> = [
    { icon: AlarmClock, label: "REC" },
    { icon: Shield, label: "Parental" },
    { icon: Lock, label: "VPN" },
    { icon: Mail, label: "MSG" },
    { icon: RefreshCw, label: "UPDATE" },
  ];

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col bg-background">
      <div className="absolute -top-32 left-1/3 size-[480px] rounded-full bg-primary/20 blur-3xl -z-10" />
      <div className="absolute -bottom-40 right-1/4 size-[520px] rounded-full bg-accent/20 blur-3xl -z-10" />

      <header className="relative flex items-center justify-between px-6 md:px-10 pt-6">
        <div className="w-40">
          <ThemeSwitcher />
        </div>

        <div className="flex flex-col items-center gap-1">
          <div className="size-14 rounded-full bg-brand-gradient shadow-glow flex items-center justify-center">
            <PlayCircle className="size-8 text-primary-foreground" />
          </div>
          <span className="text-xs tracking-[0.3em] text-muted-foreground">SOARES TV</span>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {topIcons.map(({ icon: Icon, label }) => (
            <button
              key={label}
              title={label}
              type="button"
              className="size-11 rounded-xl border border-border/60 bg-card/40 backdrop-blur flex flex-col items-center justify-center gap-0.5 text-muted-foreground hover:text-foreground hover:border-primary/50 transition"
            >
              <Icon className="size-4" />
              <span className="text-[8px] tracking-wider">{label}</span>
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5 md:gap-7 w-full max-w-5xl">
          {main.map(({ label, icon: Icon, to }) => (
            <button
              key={label}
              type="button"
              onClick={() => navigate({ to })}
              className="group relative aspect-square rounded-2xl border-2 border-border/70 bg-card/30 backdrop-blur-sm hover:border-primary hover:-translate-y-1 hover:shadow-glow transition-all duration-300 flex flex-col items-center justify-center gap-4"
            >
              <Icon className="size-16 md:size-20 text-foreground/90 group-hover:text-primary transition" />
              <span className="text-lg md:text-2xl font-bold tracking-wider text-foreground/90 group-hover:text-primary">
                {label}
              </span>
            </button>
          ))}
        </div>
      </main>

      <footer className="relative px-6 md:px-10 pb-6 flex items-end justify-between gap-4">
        <div className="flex gap-3">
          {bottomLeft.map(({ label, icon: Icon, to }) => (
            <button
              key={label}
              type="button"
              onClick={() => navigate({ to })}
              className="size-20 md:size-24 rounded-xl border border-border/60 bg-card/40 backdrop-blur hover:border-primary/70 hover:text-primary transition flex flex-col items-center justify-center gap-1.5 text-muted-foreground"
            >
              <Icon className="size-7" />
              <span className="text-[10px] font-semibold tracking-wider">{label}</span>
            </button>
          ))}
        </div>

        <div className="hidden md:flex flex-col items-center gap-1 pb-2">
          <span className="text-[10px] tracking-[0.4em] text-muted-foreground">DESENVOLVIDO POR</span>
          <span className="text-sm font-semibold text-brand-gradient">SOARESTV.APP</span>
        </div>

        <div className="flex gap-3">
          {bottomRight.map(({ label, icon: Icon, to }) => (
            <button
              key={label}
              type="button"
              onClick={() => navigate({ to })}
              className="size-20 md:size-24 rounded-xl border border-border/60 bg-card/40 backdrop-blur hover:border-primary/70 hover:text-primary transition flex flex-col items-center justify-center gap-1.5 text-muted-foreground"
            >
              <Icon className="size-7" />
              <span className="text-[10px] font-semibold tracking-wider">{label}</span>
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
