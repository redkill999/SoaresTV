import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Tv, Film, Clapperboard, Heart, History, Settings, LogOut, Search, Home, CalendarDays } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { store } from "@/lib/storage";
import { Input } from "@/components/ui/input";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const PRIMARY_NAV = [
  { to: "/live", labelKey: "nav.channels", icon: Tv },
  { to: "/movies", labelKey: "nav.movies", icon: Film },
  { to: "/series", labelKey: "nav.series", icon: Clapperboard },
  { to: "/guide", labelKey: "nav.guide", icon: CalendarDays },
] as const;

const SECONDARY_NAV = [
  { to: "/favorites", labelKey: "nav.favorites", icon: Heart },
  { to: "/history", labelKey: "nav.history", icon: History },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
] as const;

const ALL_NAV = [...PRIMARY_NAV, ...SECONDARY_NAV] as const;

export function AppShell({
  children,
  search,
  onSearch,
  immersive = false,
}: {
  children: ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
  immersive?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    const hasCreds = !!store.getCreds();
    const hasM3U = store.getM3U().length > 0;
    if (!hasCreds && !hasM3U) navigate({ to: "/" });
  }, [navigate]);

  const logout = () => {
    store.setCreds(null);
    store.setM3U([]);
    navigate({ to: "/", replace: true });
  };

  // Mapeia rotas filhas (player/playlist) para o item de menu de origem,
  // para manter o destaque do item ativo durante a navegação.
  const playerMatch = pathname.match(/^\/player\/([^/]+)/);
  const playerType = playerMatch?.[1];
  const playerParent =
    playerType === "live"
      ? "/live"
      : playerType === "movie"
        ? "/movies"
        : playerType === "series"
          ? "/series"
          : null;

  const isActive = (to: string) => {
    if (pathname === to || pathname.startsWith(to + "/")) return true;
    if (playerParent && to === playerParent) return true;
    return false;
  };

  if (immersive) {
    return <main className="min-h-dvh overflow-hidden bg-player text-player-foreground">{children}</main>;
  }

  return (
    <div className="min-h-dvh flex">
      {/* Sidebar — desktop */}
      <aside className="w-52 shrink-0 hidden lg:flex flex-col glass border-r border-border/50 p-3 sticky top-0 h-dvh">
        <Link to="/home" className="flex items-center gap-2 mb-6">
          <div className="size-8 rounded-lg bg-brand-gradient shadow-glow grid place-items-center">
            <Tv className="size-4 text-primary-foreground" strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-sm tracking-tight leading-none">
              SoaresTV
            </div>
            <div className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              IPTV Player
            </div>
          </div>
        </Link>

        <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1 px-2">
          {t("nav.library")}
        </div>
        <nav className="flex flex-col gap-0.5">
          {PRIMARY_NAV.map((n) => (
            <NavItem key={n.to} to={n.to} label={t(n.labelKey)} icon={n.icon} active={isActive(n.to)} />
          ))}
        </nav>

        <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground/70 mt-4 mb-1 px-2">
          {t("nav.general")}
        </div>
        <nav className="flex flex-col gap-0.5 flex-1">
          {SECONDARY_NAV.map((n) => (
            <NavItem key={n.to} to={n.to} label={t(n.labelKey)} icon={n.icon} active={isActive(n.to)} />
          ))}
        </nav>

        <button
          onClick={logout}
          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-white/5 transition-colors"
        >
          <LogOut className="size-3.5" />
          {t("common.signOut")}
        </button>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <div className="sticky top-0 z-20 glass border-b border-border/50">
          <div className="flex items-center gap-3 px-4 sm:px-6 py-3">
            <Link to="/live" className="lg:hidden flex items-center gap-2 shrink-0">
              <div className="size-8 rounded-lg bg-brand-gradient shadow-glow grid place-items-center">
                <Tv className="size-4 text-primary-foreground" strokeWidth={2.25} />
              </div>
              <span className="font-display font-bold tracking-tight">SoaresTV</span>
            </Link>
            {onSearch && (
              <div className="flex-1 max-w-md relative ml-auto lg:ml-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  value={search ?? ""}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder={t("common.search")}
                  className="pl-9 bg-white/5 border-white/10 rounded-full h-9"
                />
              </div>
            )}
            <div className="ml-auto shrink-0 flex items-center gap-1.5">
              <Link
                to="/home"
                title={t("common.home")}
                aria-label={t("common.home")}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-foreground transition-colors"
              >
                <Home className="size-4" />
                <span className="hidden sm:inline">{t("common.home")}</span>
              </Link>
              <LanguageSwitcher />
              <ThemeSwitcher />
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-6 flex-1 min-w-0">{children}</div>
      </main>

    </div>
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: typeof Tv;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      data-nav-item="true"
      data-active={active ? "true" : "false"}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-xs transition-all outline-none ${
        active
          ? "bg-brand-gradient text-primary-foreground shadow-glow font-medium"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
