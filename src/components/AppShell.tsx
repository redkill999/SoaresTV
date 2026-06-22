import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { Tv, Film, Clapperboard, CalendarDays, Search, Home } from "lucide-react";
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

export function AppShell({
  children,
  search,
  onSearch,
  immersive = false,
  fixedViewport = false,
}: {
  children: ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
  immersive?: boolean;
  fixedViewport?: boolean;
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
    <div className={fixedViewport ? "h-dvh overflow-hidden flex" : "min-h-dvh flex"}>
      {/* Sidebar removida — navegação principal acontece pelo header XCIPTV / topo */}

      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Top bar */}
        {!fixedViewport && <div className="sticky top-0 z-20 glass border-b border-border/50">
          <div className="flex items-center gap-2 px-2 sm:px-4 py-1.5">
            <Link to="/live" className="lg:hidden flex items-center gap-1.5 shrink-0">
              <div className="size-6 rounded-md bg-brand-gradient shadow-glow grid place-items-center">
                <Tv className="size-3.5 text-primary-foreground" strokeWidth={2.25} />
              </div>
              <span className="font-display font-bold text-xs tracking-tight">SoaresTV</span>
            </Link>
            {onSearch && (
              <div className="flex-1 max-w-md relative ml-auto lg:ml-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  value={search ?? ""}
                  onChange={(e) => onSearch(e.target.value)}
                  placeholder={t("common.search")}
                  className="pl-8 bg-white/5 border-white/10 rounded-full h-7 text-xs"
                />
              </div>
            )}
            <div className="ml-auto shrink-0 flex items-center gap-1">
              <Link
                to="/home"
                title={t("common.home")}
                aria-label={t("common.home")}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] font-medium bg-white/5 hover:bg-white/10 border border-white/10 text-foreground transition-colors"
              >
                <Home className="size-3.5" />
                <span className="hidden sm:inline">{t("common.home")}</span>
              </Link>
              <LanguageSwitcher />
              <ThemeSwitcher />
            </div>
          </div>
        </div>}


        <div className={fixedViewport ? "flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden" : "p-4 sm:p-6 flex-1 min-w-0 min-h-0 flex flex-col"}>{children}</div>
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
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-[11px] transition-all outline-none ${
        active
          ? "bg-brand-gradient text-primary-foreground shadow-glow font-medium"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
