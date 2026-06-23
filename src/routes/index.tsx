import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tv, Loader2, PlayCircle, Eye, EyeOff } from "lucide-react";
import { store } from "@/lib/storage";
import { api, discoverPanelServer, isNativeApp, login, normalizeServer, loadM3U, xtreamCredsFromUrl } from "@/lib/xtream";
import { m3uCache } from "@/lib/m3u-cache";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { NativeSplash } from "@/components/NativeSplash";
import { useTranslation } from "react-i18next";
import loginNewBg from "@/assets/login-new.png";
import loginV2Bg from "@/assets/login-v2.png";




export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SoaresTV — IPTV Player" },
      { name: "description", content: "Player IPTV com Xtream Codes, M3U, EPG e mais." },
      { property: "og:title", content: "SoaresTV — IPTV Player" },
      { property: "og:description", content: "Player IPTV com Xtream Codes, M3U, EPG e mais." },
    ],
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
  const handleNativeSplashDone = useCallback(() => setNativeSplash(false), []);

  // Xtream state
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"xtream" | "m3u">("xtream");


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
      if (native) {
        setNativeSplash(true);
        if (autoLogin) {
          // Após a splash terminar, handleNativeSplashDone vai esconder a
          // splash e este timer redireciona pra /loading.
          timer = setTimeout(() => { if (!cancelled) navigate({ to: "/loading", replace: true }); }, 5000);
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
        const playlistProbeUrl = `${normalizedServer}/get.php?username=${encodeURIComponent(
          username,
        )}&password=${encodeURIComponent(password)}&type=m3u_plus&output=m3u8`;
        try {
          entries = await loadM3U(playlistProbeUrl, username, password);
        } catch {
          entries = [];
        }

        if (!entries.length && (/dashboard|painel/i.test(server) || /não parece ser o DNS Xtream|player_api\.php\/get\.php/i.test(loginErr instanceof Error ? loginErr.message : ""))) {
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
          if (!entries.length) throw loginErr;
        }
      }

      const playlistUrl = `${normalizedServer}/get.php?username=${encodeURIComponent(
        username,
      )}&password=${encodeURIComponent(password)}&type=m3u_plus&output=m3u8`;
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
      const streams = await api<Array<{ stream_id: number }>>(creds, "get_live_streams");
      const first = streams?.[0];
      if (!first) {
        toast.error("Nenhum canal encontrado");
        return;
      }
      store.setCreds(creds);
      navigate({
        to: "/player/$type/$id",
        params: { type: "live", id: String(first.stream_id) },
        search: { name: "Canal" },
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
    return <div className="min-h-screen bg-background" />;
  }

  if (nativeSplash) {
    return <NativeSplash onDone={handleNativeSplashDone} />;
  }

  if (splash) {
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
        <img
          src={loginNewBg}
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
    <div
      className="fixed inset-0 overflow-hidden bg-black text-white"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <Toaster theme="dark" />

      {/* Background full-bleed: a arte do login (1280x720) é esticada para
          ocupar 100% da viewport. Os campos reais ficam sobrepostos em %
          alinhados aos campos desenhados na imagem. No APK nativo mantemos
          a versão antiga (com painel da marca à esquerda). */}
      {isNative ? (
        <NativeLoginLayout
          t={t}
          server={server} setServer={setServer}
          username={username} setUsername={setUsername}
          password={password} setPassword={setPassword}
          showPassword={showPassword} setShowPassword={setShowPassword}
          loading={loading} m3uLoading={m3uLoading}
          m3uName={m3uName} setM3uName={setM3uName}
          m3uUrl={m3uUrl} setM3uUrl={setM3uUrl}
          onXtream={onXtream} onM3U={onM3U}
          playFirstChannel={playFirstChannel} loadSample={loadSample}
          result={result}
        />
      ) : (
        <div className="relative h-full w-full">
          {/* Arte do login (web/desktop) preenchendo a tela toda */}
          <img
            src={loginV2Bg}
            alt=""
            aria-hidden
            draggable={false}
            className="pointer-events-none absolute inset-0 z-0 h-full w-full select-none object-fill"
          />

          {/* Idioma — área clicável transparente sobre o botão "BR PT" desenhado */}
          <div className="absolute z-40" style={{ left: "72.5%", top: "3.2%", width: "11%", height: "6.5%" }}>
            <div className="h-full w-full opacity-0 [&_button]:h-full [&_button]:w-full">
              <LanguageSwitcher />
            </div>
          </div>
          {/* Tema — área clicável transparente sobre o botão "Tema" desenhado */}
          <div className="absolute z-40" style={{ left: "85%", top: "3.2%", width: "11%", height: "6.5%" }}>
            <div className="h-full w-full opacity-0 [&_button]:h-full [&_button]:w-full">
              <ThemeSwitcher />
            </div>
          </div>

          {/* Estado visual real da aba M3U por cima da arte estática */}
          {activeTab === "m3u" && (
            <div className="pointer-events-none absolute inset-0 z-[5]">
              <div
                className="absolute rounded-xl bg-background/95 ring-1 ring-white/10"
                style={{ left: "53%", top: "23%", width: "20.5%", height: "8%" }}
              />
              <div
                className="absolute rounded-xl ring-1 ring-white/10"
                style={{
                  left: "73.5%",
                  top: "23%",
                  width: "20.5%",
                  height: "8%",
                  background: "linear-gradient(105deg, rgb(0 61 188) 0%, rgb(14 48 166) 24%, rgb(74 23 117) 50%, rgb(129 15 71) 76%, rgb(155 15 57) 100%)",
                }}
              />
              <div
                className="absolute grid place-items-center text-center font-semibold text-white/65"
                style={{ left: "53%", top: "23%", width: "20.5%", height: "8%", fontSize: "clamp(11px,1.35vw,16px)" }}
              >
                Xtream Codes
              </div>
              <div
                className="absolute grid place-items-center text-center font-semibold text-white"
                style={{ left: "73.5%", top: "23%", width: "20.5%", height: "8%", fontSize: "clamp(11px,1.35vw,16px)" }}
              >
                Lista M3U
              </div>

              <div
                className="absolute bg-background"
                style={{ left: "50.5%", top: "33%", width: "46%", height: "59%" }}
              />

              <M3UVisualField style={{ left: "52.5%", top: "36%", width: "42%", height: "8.5%" }} />
              <M3UVisualField style={{ left: "52.5%", top: "49.5%", width: "42%", height: "8.5%" }} />
              <div
                className="absolute rounded-2xl bg-brand-gradient shadow-glow"
                style={{ left: "52.5%", top: "75%", width: "42%", height: "9%" }}
              />
              <div
                className="absolute grid place-items-center text-center font-bold text-white"
                style={{ left: "52.5%", top: "75%", width: "42%", height: "9%", fontSize: "clamp(12px,1.45vw,17px)" }}
              >
                CARREGAR M3U
              </div>
              <div
                className="absolute grid place-items-center text-center font-medium text-white/70"
                style={{ left: "58%", top: "86%", width: "32%", height: "5.5%", fontSize: "clamp(10px,1.15vw,14px)" }}
              >
                Usar lista de teste
              </div>
            </div>
          )}

          {/* Abas (clicáveis sobre as abas desenhadas) */}
          <button
            type="button"
            onClick={() => setActiveTab("xtream")}
            aria-label={t("auth.tabXtream")}
            className="absolute z-10 rounded-xl outline-none transition hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white/70"
            style={{ left: "53%", top: "23%", width: "20.5%", height: "8%" }}
          />
          <button
            type="button"
            onClick={() => setActiveTab("m3u")}
            aria-label={t("auth.tabM3U")}
            className="absolute z-10 rounded-xl outline-none transition hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white/70"
            style={{ left: "73.5%", top: "23%", width: "21%", height: "8%" }}
          />

          {activeTab === "xtream" ? (
            <form onSubmit={onXtream}>
              <OverlayInput
                id="server"
                value={server}
                onChange={setServer}
                placeholder=""
                style={{ left: "52.5%", top: "36%", width: "42%", height: "8.5%" }}
                inputMode="url"
                autoComplete="url"
                required
              />
              <OverlayInput
                id="user"
                value={username}
                onChange={setUsername}
                placeholder=""
                style={{ left: "52.5%", top: "49.5%", width: "42%", height: "8.5%" }}
                autoComplete="username"
                required
              />
              <OverlayInput
                id="pass"
                value={password}
                onChange={setPassword}
                placeholder=""
                style={{ left: "52.5%", top: "63%", width: "42%", height: "8.5%" }}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                rightPad="12%"
              />
              {/* Olhinho — área clicável transparente sobre o ícone desenhado */}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                tabIndex={-1}
                className="absolute z-30 rounded-md outline-none transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/70"
                style={{ left: "89%", top: "65%", width: "6%", height: "8%" }}
              />
              {/* Entrar Xtream */}
              <button
                type="submit"
                disabled={loading}
                aria-label={t("auth.signInXtream")}
                className="absolute z-10 rounded-xl outline-none transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60 grid place-items-center"
                style={{ left: "52.5%", top: "75%", width: "42%", height: "9%" }}
              >
                {loading && <Loader2 className="size-5 animate-spin text-white" />}
              </button>
              {/* Reproduzir primeiro canal */}
              <button
                type="button"
                onClick={playFirstChannel}
                aria-label={t("auth.playFirst")}
                className="absolute z-10 rounded-md outline-none transition hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white/70"
                style={{ left: "58%", top: "86%", width: "32%", height: "5.5%" }}
              />
              {result && (
                <pre
                  className="absolute z-50 max-h-32 overflow-auto text-[10px] bg-black/70 border border-white/10 rounded-lg p-3 text-white/80 whitespace-pre-wrap break-all"
                  style={{ left: "52.5%", top: "92%", width: "42%" }}
                >
                  {result}
                </pre>
              )}
            </form>
          ) : (
            <form onSubmit={onM3U}>
              <OverlayInput
                id="m3u-name"
                value={m3uName}
                onChange={setM3uName}
                placeholder="NOME DA LISTA"
                style={{ left: "52.5%", top: "36%", width: "42%", height: "8.5%" }}
              />
              <OverlayInput
                id="m3u-url"
                value={m3uUrl}
                onChange={setM3uUrl}
                placeholder="URL M3U"
                style={{ left: "52.5%", top: "49.5%", width: "42%", height: "8.5%" }}
                inputMode="url"
                required
              />
              <button
                type="submit"
                disabled={m3uLoading}
                aria-label={t("auth.loadM3U")}
                className="absolute z-10 rounded-xl outline-none transition hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-60 grid place-items-center"
                style={{ left: "52.5%", top: "75%", width: "42%", height: "9%" }}
              >
                {m3uLoading && <Loader2 className="size-5 animate-spin text-white" />}
              </button>
              <button
                type="button"
                onClick={loadSample}
                aria-label={t("auth.useSample")}
                className="absolute z-10 rounded-md outline-none transition hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-white/70"
                style={{ left: "58%", top: "86%", width: "32%", height: "5.5%" }}
              />
            </form>
          )}
        </div>
      )}

    </div>
  );
}

/* -------- Overlay input that sits on top of the drawn field -------- */
function OverlayInput({
  id, value, onChange, placeholder, style, type = "text",
  autoComplete, inputMode, required, rightPad = "4%", leftPad = "11%",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style: React.CSSProperties;
  type?: string;
  autoComplete?: string;
  inputMode?: "url" | "text" | "email" | "search" | "none" | "tel" | "numeric" | "decimal";
  required?: boolean;
  rightPad?: string;
  leftPad?: string;
}) {
  return (
    <input
      id={id}
      name={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      inputMode={inputMode}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      required={required}
      className="absolute z-20 bg-transparent text-white placeholder:text-white/40 outline-none focus:bg-black/40 focus:ring-2 focus:ring-white/40 rounded-xl"
      style={{
        ...style,
        paddingLeft: leftPad,
        paddingRight: rightPad,
        fontSize: "clamp(12px, 1.6vw, 18px)",
      }}
    />
  );
}

function M3UVisualField({ style }: { style: React.CSSProperties }) {
  return (
    <div
      className="absolute rounded-2xl bg-background/95 ring-1 ring-white/15"
      style={style}
    />
  );
}

/* -------- Native layout (APK) — mantém o card antigo com painel da marca -------- */
type NativeProps = {
  t: ReturnType<typeof useTranslation>["t"];
  server: string; setServer: (v: string) => void;
  username: string; setUsername: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  showPassword: boolean; setShowPassword: (v: boolean | ((p: boolean) => boolean)) => void;
  loading: boolean; m3uLoading: boolean;
  m3uName: string; setM3uName: (v: string) => void;
  m3uUrl: string; setM3uUrl: (v: string) => void;
  onXtream: (e: React.FormEvent) => void;
  onM3U: (e: React.FormEvent) => void;
  playFirstChannel: () => void;
  loadSample: () => void;
  result: string;
};

function NativeLoginLayout(p: NativeProps) {
  const { t } = p;
  return (
    <div className="relative min-h-dvh flex items-center justify-center px-3 sm:px-4 py-3 sm:py-6 overflow-y-auto">
      <img
        src={loginNewBg}
        alt=""
        aria-hidden
        className="fixed inset-0 z-0 h-full w-full object-cover pointer-events-none"
      />
      <div className="fixed inset-0 z-0 bg-black/40 pointer-events-none" />
      <div className="fixed top-2 right-2 sm:top-3 sm:right-3 z-50 flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>

      <div className="w-full max-w-5xl relative z-10">
        <div className="flex items-center gap-3 mb-3 mt-8 sm:mt-10">
          <div className="size-9 sm:size-10 rounded-xl bg-brand-gradient shadow-glow grid place-items-center shrink-0">
            <Tv className="size-4 sm:size-5 text-white" strokeWidth={2.25} />
          </div>
          <span className="font-semibold text-base sm:text-lg truncate">{t("auth.appName")}</span>
        </div>

        <div className="glass rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 shadow-card border border-white/10 flex flex-col">
          <h2 className="text-2xl font-bold">{t("auth.signIn")}</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-5">{t("auth.signInSub")}</p>

          <Tabs defaultValue="xtream">
            <TabsList className="grid grid-cols-2 w-full bg-white/5 mb-5">
              <TabsTrigger value="xtream" className="data-[state=active]:bg-brand-gradient data-[state=active]:text-white">{t("auth.tabXtream")}</TabsTrigger>
              <TabsTrigger value="m3u" className="data-[state=active]:bg-brand-gradient data-[state=active]:text-white">{t("auth.tabM3U")}</TabsTrigger>
            </TabsList>

            <TabsContent value="xtream">
              <form onSubmit={p.onXtream} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="server" className="text-xs tracking-wider text-muted-foreground">{t("auth.server")}</Label>
                  <Input id="server" required autoComplete="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="http://meuservidor.com:8080" value={p.server} onChange={(e) => p.setServer(e.target.value)} className="bg-white/5 border-white/10 h-12 text-base" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user" className="text-xs tracking-wider text-muted-foreground">{t("auth.user")}</Label>
                  <Input id="user" required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={p.username} onChange={(e) => p.setUsername(e.target.value)} className="bg-white/5 border-white/10 h-12 text-base" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pass" className="text-xs tracking-wider text-muted-foreground">{t("auth.password")}</Label>
                  <div className="relative">
                    <Input id="pass" required type={p.showPassword ? "text" : "password"} autoComplete="current-password" value={p.password} onChange={(e) => p.setPassword(e.target.value)} className="bg-white/5 border-white/10 h-12 text-base pr-12" />
                    <button type="button" onClick={() => p.setShowPassword((v) => !v)} aria-label={p.showPassword ? "Ocultar senha" : "Mostrar senha"} tabIndex={-1} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-muted-foreground hover:text-white hover:bg-white/10">
                      {p.showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" disabled={p.loading} className="w-full bg-brand-gradient shadow-glow font-semibold h-12">
                  {p.loading ? <Loader2 className="size-4 animate-spin" /> : t("auth.signInXtream")}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="w-full text-muted-foreground hover:text-foreground" onClick={p.playFirstChannel}>
                  <PlayCircle className="size-4 mr-1.5" />{t("auth.playFirst")}
                </Button>
                {p.result && (
                  <pre className="mt-3 max-h-40 overflow-auto text-[10px] bg-black/40 border border-white/10 rounded-lg p-3 text-muted-foreground whitespace-pre-wrap break-all">{p.result}</pre>
                )}
              </form>
            </TabsContent>

            <TabsContent value="m3u">
              <form onSubmit={p.onM3U} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="m3u-name" className="text-xs tracking-wider text-muted-foreground">{t("auth.listName")}</Label>
                  <Input id="m3u-name" placeholder={t("auth.listNamePh")} value={p.m3uName} onChange={(e) => p.setM3uName(e.target.value)} className="bg-white/5 border-white/10 h-12 text-base" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m3u-url" className="text-xs tracking-wider text-muted-foreground">{t("auth.m3uUrl")}</Label>
                  <Input id="m3u-url" required inputMode="url" placeholder="http://..." value={p.m3uUrl} onChange={(e) => p.setM3uUrl(e.target.value)} className="bg-white/5 border-white/10 h-12 text-base" />
                </div>
                <Button type="submit" disabled={p.m3uLoading} className="w-full bg-brand-gradient shadow-glow font-semibold h-12">
                  {p.m3uLoading ? <Loader2 className="size-4 animate-spin" /> : t("auth.loadM3U")}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="w-full text-muted-foreground hover:text-foreground" onClick={p.loadSample}>{t("auth.useSample")}</Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="text-[11px] text-muted-foreground text-center mt-5">{t("auth.credsLocal")}</p>
        </div>
      </div>
    </div>
  );
}


