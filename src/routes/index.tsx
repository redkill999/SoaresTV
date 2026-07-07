import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tv, Loader2, PlayCircle, Eye, EyeOff } from "lucide-react";
import { store } from "@/lib/storage";
import { api, discoverPanelServer, isNativeApp, login, normalizeServer, loadM3U, xtreamCredsFromUrl, type LiveStream } from "@/lib/xtream";
import { m3uCache } from "@/lib/m3u-cache";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { NativeSplash } from "@/components/NativeSplash";
import { useTranslation } from "react-i18next";
import loginBgWebAsset from "@/assets/login-web.png.asset.json";
import { isTvDevice } from "@/lib/tv-dpad";

function buildLoginPlaylistUrl(server: string, username: string, password: string): string {
  const base = server.replace(/\/+$/, "");
  const u = new URL(`${base}/get.php`);
  u.searchParams.set("username", username);
  u.searchParams.set("password", password);
  u.searchParams.set("type", "m3u_plus");
  // Default global = "ts": evita que painéis sem variante HLS retornem 404
  // em todos os canais LIVE. O player faz fallback .ts <-> .m3u8 quando preciso.
  u.searchParams.set("output", "ts");
  return u.toString();
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SoaresTV — Login IPTV com Xtream Codes e M3U" },
      { name: "description", content: "Acesse a SoaresTV: player IPTV completo com login Xtream Codes ou lista M3U, guia EPG, filmes, séries e canais ao vivo em qualquer dispositivo." },
      { property: "og:title", content: "SoaresTV — Login IPTV com Xtream Codes e M3U" },
      { property: "og:description", content: "Player IPTV completo com login Xtream Codes ou lista M3U, guia EPG, filmes, séries e canais ao vivo em qualquer dispositivo." },
      { property: "og:url", content: "https://tv-magica-brasa-soarestv.lovable.app/" },
    ],
    links: [{ rel: "canonical", href: "https://tv-magica-brasa-soarestv.lovable.app/" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [splash, setSplash] = useState(false);
  const [nativeSplash, setNativeSplash] = useState(false);
  const [splashReady, setSplashReady] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [isTv, setIsTv] = useState(false);
  const handleNativeSplashDone = useCallback(() => setNativeSplash(false), []);

  // Xtream state
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  // M3U state
  const [m3uName, setM3uName] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [m3uUser, setM3uUser] = useState("");
  const [m3uPass, setM3uPass] = useState("");
  const [m3uLoading, setM3uLoading] = useState(false);

  useEffect(() => {
    // Permite forçar logout/reset via ?reset=1 — limpa tudo e mostra o login.
    const isReset = typeof window !== "undefined" && /[?&]reset=1\b/.test(window.location.search);
    if (isReset) {
      try { window.localStorage.clear(); } catch { /* noop */ }
      try { window.sessionStorage.clear(); } catch { /* noop */ }
      window.history.replaceState(null, "", window.location.pathname);
    }
    const hasCreds = !isReset && !!store.getCreds();
    const hasList = !isReset && (store.getM3U() ?? []).length > 0;
    const autoLogin = hasCreds || hasList;

    // Splash animado estilo XCIPTV: ~5s no APK Android (celular/TV),
    // splash curto de 600ms na web. No auto-login mantemos a splash do
    // APK por completo antes de pular pra /loading — sem ela, o usuário
    // nunca vê a animação porque a navegação acontece em milissegundos.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    void isNativeApp().then((native) => {
      if (cancelled) return;
      setIsNative(native);
      setIsTv(isTvDevice());
      if (native) {
        setNativeSplash(true);
        if (autoLogin) {
          // Após a splash terminar, handleNativeSplashDone vai esconder a
          // splash e este timer redireciona pra /loading.
          timer = setTimeout(() => { if (!cancelled) navigate({ to: "/loading", replace: true }); }, 2800);
        }
      } else {
        if (autoLogin) {
          navigate({ to: "/loading", replace: true });
          setSplashReady(true);
          return;
        }
        setSplash(true);
        timer = setTimeout(() => { if (!cancelled) setSplash(false); }, 600);
      }
      setSplashReady(true);
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [navigate]);

  const onXtream = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult("");
    let normalizedServer = normalizeServer(server);
    let creds = { server: normalizedServer, username, password };

    try {
      let info: unknown = null;
      let entries: Awaited<ReturnType<typeof loadM3U>> = [];

      try {
        info = await login(creds);
        normalizedServer = normalizeServer(creds.server);
      } catch (loginErr) {
        const native = await isNativeApp();
        const playlistProbeUrl = buildLoginPlaylistUrl(normalizedServer, username, password);
        let m3uTimedOut = false;
        try {
          entries = await withTimeout(
            loadM3U(playlistProbeUrl, username, password),
            native ? 12_000 : 30_000,
            "Tempo esgotado ao tentar carregar a lista M3U.",
          );
        } catch (m3uErr) {
          m3uTimedOut = isTimeoutError(m3uErr);
          entries = [];
        }

        if (!entries.length && !m3uTimedOut && (/dashboard|painel/i.test(server) || /não parece ser o DNS Xtream|player_api\.php\/get\.php/i.test(loginErr instanceof Error ? loginErr.message : ""))) {
          try {
            const discovered = await discoverPanelServer(creds);
            normalizedServer = discovered.server;
            creds = { server: normalizedServer, username, password };
            info = await login(creds);
          } catch {
            throw loginErr;
          }
        } else {
          if (!native && /HTTP 50[1234]|datacenter|rejeitou o acesso/i.test(loginErr instanceof Error ? loginErr.message : "")) {
            throw new Error("Esse servidor bloqueou a conexão da versão web antes de autenticar. Não salvei nada para não bagunçar as listas que já funcionam.");
          }
          if (native && m3uTimedOut) {
            throw new Error("Tempo esgotado ao conectar. Verifique se o DNS/porta do servidor IPTV está correto.");
          }
          if (!entries.length) throw loginErr;
        }
      }

      const playlistUrl = buildLoginPlaylistUrl(normalizedServer, username, password);
      const listName = `Xtream — ${new URL(normalizedServer).hostname}`;
      const savedList = { name: listName, url: playlistUrl, username, password, mode: "xtream" as const };

      store.setCreds(creds);
      const others = store.getM3U().filter((l) => l.url !== playlistUrl);
      store.setM3U([savedList, ...others]);

      if (!info && !entries.length) throw new Error("Não consegui autenticar nem carregar a lista M3U desse servidor.");

      if (entries.length) {
        m3uCache.set(playlistUrl, listName, entries);
        toast.success(`${entries.length} itens carregados`);
      } else {
        toast.success("Conectado ao Xtream!");
      }

      setResult("");
      setTimeout(() => navigate({ to: "/loading" }), 400);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      setResult(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const playFirstChannel = async () => {
    if (!server || !username || !password) {
      toast.error("Preencha DNS / usuário / senha");
      return;
    }
    const creds = { server, username, password };
    try {
      const streams = await api<LiveStream[]>(creds, "get_live_streams");
      const first = streams?.[0];
      if (!first) {
        toast.error("Nenhum canal encontrado");
        return;
      }
      store.setCreds(creds);
      navigate({
        to: "/player/$type/$id",
        params: { type: "live", id: String(first.stream_id) },
        search: first.url ? { name: first.name || "Canal", src: first.url } : { name: first.name || "Canal" },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  };

  const onM3U = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = m3uUrl.trim();
    const url = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    const name = m3uName.trim() || "Lista M3U";
    const user = m3uUser.trim() || undefined;
    const pass = m3uPass.trim() || undefined;
    const savedList = { name, url, username: user, password: pass, mode: "playlist" as const };
    const others = store.getM3U().filter((l) => l.url !== url);
    // Always put the just-saved playlist FIRST so the home launcher opens it.
    store.setM3U([savedList, ...others]);
    const xtreamCreds = xtreamCredsFromUrl(url, user, pass);
    if (xtreamCreds) store.setCreds(xtreamCreds);
    setM3uLoading(true);
    try {
      const entries = await loadM3U(url, user, pass);
      if (!entries.length) throw new Error("Lista vazia");
      m3uCache.set(url, name, entries);
      toast.success(`${entries.length} canais carregados`);
      navigate({ to: "/loading" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar M3U");
    } finally {
      setM3uLoading(false);
    }
  };

  const loadSample = () => {
    setM3uName("IPTV-Org (teste)");
    setM3uUrl("https://iptv-org.github.io/iptv/index.m3u");
  };

  if (!splashReady) {
    return <div className="min-h-dvh bg-background" />;
  }

  if (nativeSplash) {
    return <NativeSplash onDone={handleNativeSplashDone} />;
  }

  if (splash) {
    return (
      <div className="min-h-dvh flex items-center justify-center relative overflow-hidden">
        <img
          src={`${loginBgWebAsset.url}?v=${loginBgWebAsset.asset_id}`}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/55" />
        <div className="text-center">
          <div className="size-20 rounded-3xl bg-brand-gradient shadow-glow mx-auto mb-4 animate-pulse" />
          <h1 className="text-3xl font-bold text-brand-gradient">{t("auth.appName")}</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-start xl:items-center justify-center px-3 sm:px-4 py-3 sm:py-6 xl:py-10 relative">
      <h1 className="sr-only">SoaresTV — Login IPTV com Xtream Codes e M3U</h1>
      <Toaster theme="dark" />
      {isNative && <div className="fixed inset-0 z-0 bg-black pointer-events-none" />}

      <div className="fixed top-2 right-2 sm:top-3 sm:right-3 z-50 flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>

      {/* Mobile/landscape-pequeno brand header — escondido só em telas largas onde o painel da esquerda aparece */}
      <div className="w-full max-w-5xl relative z-10">
        <div className="lg:hidden flex items-center gap-3 mb-3 mt-8 sm:mt-10">
          <div className="size-9 sm:size-10 rounded-xl bg-brand-gradient shadow-glow grid place-items-center shrink-0">
            <Tv className="size-4 sm:size-5 text-white" strokeWidth={2.25} />
          </div>
          <span className="font-semibold text-base sm:text-lg truncate">{t("auth.appName")}</span>
        </div>

      <div className="w-full grid lg:grid-cols-2 gap-6">
        {/* Left — brand panel: só no app nativo. Na web a imagem de fundo já mostra esse painel. */}
        {isNative && !isTv ? (
          <div className="hidden lg:flex relative overflow-hidden rounded-3xl bg-brand-gradient shadow-glow lg:min-h-[420px] xl:min-h-[460px]">
            <div className="p-6 md:p-8 xl:p-10 flex flex-col justify-between w-full">
              <div>
                <div className="flex items-center gap-3 mb-8 xl:mb-12">
                  <div className="size-11 rounded-xl bg-black/30 backdrop-blur grid place-items-center shrink-0">
                    <Tv className="size-5 text-white" strokeWidth={2.25} />
                  </div>
                  <span className="font-semibold text-lg truncate">{t("auth.appName")}</span>
                </div>
                <h1 className="text-3xl md:text-4xl xl:text-5xl font-bold tracking-tight leading-[1.1]">
                  {t("auth.heroTitle")}
                </h1>
                <p className="mt-4 xl:mt-5 text-sm xl:text-base text-white/85 max-w-sm leading-relaxed">
                  {t("auth.heroDesc")}
                </p>
              </div>
              <ul className="space-y-2 xl:space-y-2.5 text-sm text-white/95 mt-4">
                <li className="flex items-center gap-2"><PlayCircle className="size-4 shrink-0" /> {t("auth.feat1")}</li>
                <li className="flex items-center gap-2"><PlayCircle className="size-4 shrink-0" /> {t("auth.feat2")}</li>
                <li className="flex items-center gap-2"><PlayCircle className="size-4 shrink-0" /> {t("auth.feat3")}</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="hidden lg:block relative overflow-hidden rounded-3xl bg-black aspect-[8/9] w-full lg:mt-20">
            {/* A imagem original é 1280×720 (16:9) com dois painéis lado a lado.
                Cada metade é 640×720 (8:9). Damos ao container aspect-[8/9] e à imagem
                largura 200% alinhada à esquerda — assim a METADE ESQUERDA (SoaresTV)
                preenche o painel inteiro sem cortar nada. */}
            <img
              src={`${loginBgWebAsset.url}?v=${loginBgWebAsset.asset_id}`}
              alt=""
              aria-hidden
              className="absolute inset-y-0 left-0 h-full w-[200%] max-w-none object-cover object-left"
            />
          </div>
        )}

        {/* Right — login card */}
        <div className="glass rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 shadow-card border border-white/10 lg:min-h-[420px] xl:min-h-[460px] flex flex-col lg:mt-20">
          <h2 className="text-2xl font-bold">{t("auth.signIn")}</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-5">
            {t("auth.signInSub")}
          </p>

          <Tabs defaultValue="xtream">
            <TabsList className="grid grid-cols-2 w-full bg-white/5 mb-5">
              <TabsTrigger value="xtream" className="data-[state=active]:bg-brand-gradient data-[state=active]:text-white">
                {t("auth.tabXtream")}
              </TabsTrigger>
              <TabsTrigger value="m3u" className="data-[state=active]:bg-brand-gradient data-[state=active]:text-white">
                {t("auth.tabM3U")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="xtream">
              <form onSubmit={onXtream} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="server" className="text-xs tracking-wider text-muted-foreground">{t("auth.server")}</Label>
                  <Input
                    id="server"
                    data-tv-default-focus
                    required
                    autoComplete="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="http://meuservidor.com:8080"
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 250)}
                    className="bg-white/5 border-white/10 h-12 text-base focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary/60"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user" className="text-xs tracking-wider text-muted-foreground">{t("auth.user")}</Label>
                  <Input
                    id="user"
                    required
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 250)}
                    className="bg-white/5 border-white/10 h-12 text-base focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary/60"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pass" className="text-xs tracking-wider text-muted-foreground">{t("auth.password")}</Label>
                  <div className="relative">
                    <Input
                      id="pass"
                      required
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 250)}
                      className="bg-white/5 border-white/10 h-12 text-base pr-12 focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary/60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      tabIndex={0}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-gradient shadow-glow font-semibold h-12"
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : t("auth.signInXtream")}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={playFirstChannel}
                >
                  <PlayCircle className="size-4 mr-1.5" />
                  {t("auth.playFirst")}
                </Button>

                {result && (
                  <pre className="mt-3 max-h-40 overflow-auto text-[10px] bg-black/40 border border-white/10 rounded-lg p-3 text-muted-foreground whitespace-pre-wrap break-all">
                    {result}
                  </pre>
                )}
              </form>
            </TabsContent>

            <TabsContent value="m3u">
              <form onSubmit={onM3U} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="m3u-name" className="text-xs tracking-wider text-muted-foreground">{t("auth.listName")}</Label>
                  <Input
                    id="m3u-name"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={t("auth.listNamePh")}
                    value={m3uName}
                    onChange={(e) => setM3uName(e.target.value)}
                    onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 250)}
                    className="bg-white/5 border-white/10 h-12 text-base focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary/60"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m3u-url" className="text-xs tracking-wider text-muted-foreground">{t("auth.m3uUrl")}</Label>
                  <Input
                    id="m3u-url"
                    required
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="http://seudns.com:8080 ou https://exemplo.com/lista.m3u"
                    value={m3uUrl}
                    onChange={(e) => setM3uUrl(e.target.value)}
                    onFocus={(e) => setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 250)}
                    className="bg-white/5 border-white/10 h-12 text-base focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary/60"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {t("auth.m3uHint")}
                  </p>
                </div>
                <Button
                  type="submit"
                  disabled={m3uLoading}
                  className="w-full bg-brand-gradient shadow-glow font-semibold h-12"
                >
                  {m3uLoading ? <Loader2 className="size-4 animate-spin" /> : t("auth.loadM3U")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={loadSample}
                >
                  {t("auth.useSample")}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="text-[11px] text-muted-foreground text-center mt-5">
            {t("auth.credsLocal")}
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise.finally(() => { if (timer) clearTimeout(timer); }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && /tempo esgotado|timeout|abort/i.test(err.message);
}

