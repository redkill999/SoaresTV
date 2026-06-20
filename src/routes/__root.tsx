import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ThemeProvider } from "../components/ThemeSwitcher";
import { syncLangFromStorage } from "../lib/i18n";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // viewport is set dynamically by TV_MODE_SCRIPT (mobile -> width=1280, else width=device-width)
      { title: "SoaresTV — IPTV Player" },
      { name: "description", content: "Player IPTV web com Xtream Codes, M3U, EPG, filmes e séries." },
      { name: "author", content: "SoaresTV" },
      // PWA / Smart TV / Android wrappers
      { name: "application-name", content: "SoaresTV" },
      { name: "apple-mobile-web-app-title", content: "SoaresTV" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "theme-color", content: "#0b0f1a" },
      { name: "msapplication-TileColor", content: "#0b0f1a" },
      { property: "og:title", content: "SoaresTV — IPTV Player" },
      { property: "og:description", content: "Player IPTV web com Xtream Codes, M3U, EPG, filmes e séries." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "SoaresTV — IPTV Player" },
      { name: "twitter:description", content: "Player IPTV web com Xtream Codes, M3U, EPG, filmes e séries." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e11cd8f8-17a4-4720-ba05-d2aa25e94e5f/id-preview-e5fd133c--7e27fbd1-c4eb-4da3-b3cd-6957171df823.lovable.app-1781796900386.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/e11cd8f8-17a4-4720-ba05-d2aa25e94e5f/id-preview-e5fd133c--7e27fbd1-c4eb-4da3-b3cd-6957171df823.lovable.app-1781796900386.png" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      // PWA / Android TV / instaláveis (Capacitor, Median.co, PWA Builder)
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icons/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icons/icon-512.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/icons/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const TV_MODE_SCRIPT = `(function(){
  try {
    if (typeof window === 'undefined') return;
    function apply(){
      var sw = (window.screen && window.screen.width) || window.innerWidth;
      var sh = (window.screen && window.screen.height) || window.innerHeight;
      var maxDim = Math.max(sw, sh);
      var minDim = Math.min(sw, sh);
      var hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      var ua = (navigator.userAgent || '').toLowerCase();
      var isPhoneOrTablet = hasTouch || /android|iphone|ipad|ipod|mobile/.test(ua);
      // Smart TVs: Tizen (Samsung), WebOS (LG), AndroidTV, GoogleTV, FireTV (AFT*), Hisense/VIDAA, NetCast, Roku, BRAVIA
      var isSmartTV = /smart-tv|smarttv|tizen|web0s|webos|netcast|googletv|android tv|hbbtv|appletv|crkey|nettv|aft[a-z]|firetv|bravia|vidaa|hisense|philipstv|roku|playstation|nintendo|xbox/.test(ua);
      // Dentro do APK (Capacitor) sempre tratamos como TV pra replicar o layout do XCIPTV.
      var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
      // TV mode: smart TV UA, app nativo, OU tela grande landscape sem touch.
      var isTV = isNative || isSmartTV || (!isPhoneOrTablet && maxDim >= 1280 && minDim >= 720);
      var html = document.documentElement;
      if (isSmartTV) html.setAttribute && document.documentElement.setAttribute('data-smart-tv','');

      var metas = document.querySelectorAll('meta[name="viewport"]');
      for (var i = 0; i < metas.length; i++) metas[i].parentNode.removeChild(metas[i]);
      var m = document.createElement('meta');
      m.setAttribute('name','viewport');
      m.setAttribute('content', isTV
        ? 'width=1280, initial-scale=1, user-scalable=no'
        : 'width=device-width, initial-scale=1, viewport-fit=cover');
      document.head.appendChild(m);
      if (isTV) {
        html.setAttribute('data-tv-mode','');
        setTimeout(function(){
          var vw = window.innerWidth;
          var vh = window.innerHeight;
          var portrait = vh > vw;
          var scale = portrait
            ? Math.min(vw / 720, vh / 1280)
            : Math.min(vw / 1280, vh / 720);
          html.style.setProperty('--tv-scale', String(scale));
          html.style.setProperty('--tv-vw', vw + 'px');
          html.style.setProperty('--tv-vh', vh + 'px');
          html.setAttribute('data-tv-orientation', portrait ? 'portrait' : 'landscape');
        }, 30);
      } else {
        html.removeAttribute('data-tv-mode');
        html.removeAttribute('data-tv-orientation');
        html.style.removeProperty('--tv-scale');
        html.style.removeProperty('--tv-vw');
        html.style.removeProperty('--tv-vh');
      }
    }
    apply();
    if (!window.__tvModeBound) {
      window.__tvModeBound = true;
      window.addEventListener('resize', apply);
      window.addEventListener('orientationchange', apply);
    }
  } catch(e) {}
})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: TV_MODE_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();



  // Re-apply TV mode after React hydration in case hydration cleared the attribute / meta
  useEffect(() => {
    try {
      // eslint-disable-next-line no-new-func
      new Function(TV_MODE_SCRIPT)();
    } catch {}
    // Aplica idioma salvo após hidratação (evita mismatch SSR).
    syncLangFromStorage();
    // Hidrata o cache persistente (IndexedDB) o quanto antes para que
    // Filmes/Séries abram instantaneamente em reloads.
    void import("@/lib/query-persist").then((m) => m.hydratePersistedCache());
    // Dentro do APK (Capacitor): trava landscape igual XCIPTV.
    const w = window as any;
    if (w?.Capacitor?.isNativePlatform?.()) {
      void import("@capacitor/screen-orientation")
        .then((m) => m.ScreenOrientation.lock({ orientation: "landscape" }))
        .catch(() => {});
      // Hardware back button (Android/AndroidTV): volta na história ou sai do app.
      void import("@capacitor/app")
        .then(({ App }) => {
          App.addListener("backButton", () => {
            if (["/live", "/movies", "/series"].includes(window.location.pathname)) {
              void router.navigate({ to: "/home" });
              return;
            }
            if (window.history.length > 1) {
              router.history.back();
            } else {
              App.exitApp();
            }
          });
        })
        .catch(() => {});
    }
    // Controle remoto / teclado (D-pad). Funciona em Smart TV (Tizen,
    // WebOS, AndroidTV, FireTV), Capacitor (Android) e também desktop —
    // o handler ignora inputs e só intercepta setas quando há foco.
    void import("@/lib/tv-dpad").then((m) => m.initTvDpad());
  }, [router]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
