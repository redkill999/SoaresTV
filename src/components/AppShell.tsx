import { Link, useRouterState } from "@tanstack/react-router";
import { Tv, Film, Clapperboard, Heart, History, Settings, LogOut, Search } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { store } from "@/lib/storage";
import { useNavigate } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

const NAV = [
  { to: "/live", label: "Ao Vivo", icon: Tv },
  { to: "/movies", label: "Filmes", icon: Film },
  { to: "/series", label: "Séries", icon: Clapperboard },
  { to: "/favorites", label: "Favoritos", icon: Heart },
  { to: "/history", label: "Histórico", icon: History },
  { to: "/settings", label: "Ajustes", icon: Settings },
] as const;

export function AppShell({
  children,
  search,
  onSearch,
}: {
  children: ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const hasCreds = !!store.getCreds();
    const hasM3U = store.getM3U().length > 0;
    if (!hasCreds && !hasM3U) navigate({ to: "/" });
  }, [navigate]);

  if (!mounted) return null;

  const logout = () => {
    store.setCreds(null);
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 hidden md:flex flex-col glass border-r border-border/50 p-5 sticky top-0 h-screen">
        <Link to="/live" className="flex items-center gap-2 mb-8">
          <div className="size-9 rounded-xl bg-brand-gradient shadow-glow" />
          <div>
            <div className="font-bold text-lg tracking-tight">SoaresTV</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              IPTV Player
            </div>
          </div>
        </Link>

        <nav className="flex flex-col gap-1 flex-1">
          {NAV.map((n) => {
            const active = pathname === n.to || pathname.startsWith(n.to + "/");
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  active
                    ? "bg-brand-gradient text-primary-foreground shadow-glow"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                <Icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={logout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-white/5"
        >
          <LogOut className="size-4" />
          Sair
        </button>
      </aside>

      <main className="flex-1 min-w-0">
        {/* Top bar */}
        <div className="sticky top-0 z-20 glass border-b border-border/50">
          <div className="flex items-center gap-4 px-6 py-3">
            <div className="md:hidden flex items-center gap-2">
              <div className="size-7 rounded-lg bg-brand-gradient" />
              <span className="font-bold">SoaresTV</span>
            </div>
            {onSearch && (
              <div className="flex-1 max-w-md relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  value={search ?? ""}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder="Buscar…"
                  className="pl-9 bg-white/5 border-white/10"
                />
              </div>
            )}
            <div className="ml-auto">
              <ThemeSwitcher />
            </div>
          </div>
          {/* Mobile nav */}
          <div className="md:hidden flex gap-1 overflow-x-auto px-3 pb-3">
            {NAV.map((n) => {
              const active = pathname === n.to;
              const Icon = n.icon;
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${
                    active
                      ? "bg-brand-gradient text-primary-foreground"
                      : "text-muted-foreground bg-white/5"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
