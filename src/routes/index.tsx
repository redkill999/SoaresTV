import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tv, Loader2, ListVideo, PlayCircle, PlayCircle as PlayIcon } from "lucide-react";
import { store } from "@/lib/storage";
import { api, login, streamUrl, loadM3U } from "@/lib/xtream";
import { m3uCache } from "@/lib/m3u-cache";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

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
  const [splash, setSplash] = useState(true);

  // Xtream state
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");

  // M3U state
  const [m3uName, setM3uName] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [m3uUser, setM3uUser] = useState("");
  const [m3uPass, setM3uPass] = useState("");
  const [m3uLoading, setM3uLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 800);
    return () => clearTimeout(t);
  }, []);

  const onXtream = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult("");
    const creds = { server, username, password };
    try {
      const info = await login(creds);
      store.setCreds(creds);
      setResult(JSON.stringify(info, null, 2));
      toast.success("Conectado ao Xtream!");
      setTimeout(() => navigate({ to: "/home" }), 600);
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
    const savedList = { name, url, username: user, password: pass };
    const others = store.getM3U().filter((l) => l.url !== url);
    // Always put the just-saved playlist FIRST so the home launcher opens it.
    store.setM3U([savedList, ...others]);
    setM3uLoading(true);
    try {
      const entries = await loadM3U(url, user, pass);
      if (!entries.length) throw new Error("Lista vazia");
      m3uCache.set(url, name, entries);
      toast.success(`${entries.length} canais carregados`);
      navigate({ to: "/home" });
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

  if (splash) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="size-20 rounded-3xl bg-brand-gradient shadow-glow mx-auto mb-4 animate-pulse" />
          <h1 className="text-3xl font-bold text-brand-gradient">SoaresTV</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 relative">
      <Toaster theme="dark" />
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 size-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 size-96 rounded-full bg-accent/20 blur-3xl" />
      </div>

      <div className="absolute top-4 right-4 z-10">
        <ThemeSwitcher />
      </div>

      <div className="w-full max-w-5xl grid md:grid-cols-2 gap-6">
        {/* Left — brand panel with gradient */}
        <div className="relative overflow-hidden rounded-3xl p-8 md:p-10 bg-brand-gradient shadow-glow min-h-[520px] flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-12">
              <div className="size-11 rounded-xl bg-black/30 backdrop-blur flex items-center justify-center font-bold text-lg">
                S
              </div>
              <span className="font-semibold text-lg">SoaresTV</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.1]">
              Seu IPTV, em<br />qualquer tela.
            </h1>
            <p className="mt-5 text-white/85 max-w-sm leading-relaxed">
              Canais ao vivo, filmes, séries, EPG, favoritos e controle parental — tudo num só app.
            </p>
          </div>
          <ul className="space-y-2.5 text-sm text-white/95">
            <li className="flex items-center gap-2"><PlayIcon className="size-4" /> Player HLS otimizado</li>
            <li className="flex items-center gap-2"><PlayIcon className="size-4" /> Suporte Xtream Codes e M3U</li>
            <li className="flex items-center gap-2"><PlayIcon className="size-4" /> EPG XMLTV + favoritos</li>
          </ul>
        </div>

        {/* Right — login card */}
        <div className="glass rounded-3xl p-6 md:p-8 shadow-card border border-white/10">
          <h2 className="text-2xl font-bold">Entrar</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-5">
            Escolha como deseja acessar seu conteúdo.
          </p>

          <Tabs defaultValue="xtream">
            <TabsList className="grid grid-cols-2 w-full bg-white/5 mb-5">
              <TabsTrigger value="xtream" className="data-[state=active]:bg-brand-gradient data-[state=active]:text-white">
                Xtream Codes
              </TabsTrigger>
              <TabsTrigger value="m3u">
                Lista M3U
              </TabsTrigger>
            </TabsList>

            <TabsContent value="xtream">
              <form onSubmit={onXtream} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="server" className="text-xs tracking-wider text-muted-foreground">DNS / SERVIDOR</Label>
                  <Input
                    id="server"
                    required
                    placeholder="http://meuservidor.com:8080"
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    className="bg-white/5 border-white/10 h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user" className="text-xs tracking-wider text-muted-foreground">USUÁRIO</Label>
                  <Input
                    id="user"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="bg-white/5 border-white/10 h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pass" className="text-xs tracking-wider text-muted-foreground">SENHA</Label>
                  <Input
                    id="pass"
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-white/5 border-white/10 h-11"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-gradient shadow-glow font-semibold h-11"
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : "Entrar Xtream"}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={playFirstChannel}
                >
                  <PlayCircle className="size-4 mr-1.5" />
                  Reproduzir primeiro canal
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
                  <Label htmlFor="m3u-name" className="text-xs tracking-wider text-muted-foreground">NOME DA LISTA</Label>
                  <Input
                    id="m3u-name"
                    placeholder="Minha lista"
                    value={m3uName}
                    onChange={(e) => setM3uName(e.target.value)}
                    className="bg-white/5 border-white/10 h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m3u-url" className="text-xs tracking-wider text-muted-foreground">URL .M3U / DNS XTREAM</Label>
                  <Input
                    id="m3u-url"
                    required
                    placeholder="http://seudns.com:8080 ou https://exemplo.com/lista.m3u"
                    value={m3uUrl}
                    onChange={(e) => setM3uUrl(e.target.value)}
                    className="bg-white/5 border-white/10 h-11"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Aceita URL Xtream (DNS + usuário/senha abaixo) ou link direto .m3u/.m3u8.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="m3u-user" className="text-xs tracking-wider text-muted-foreground">USUÁRIO (XTREAM)</Label>
                    <Input
                      id="m3u-user"
                      placeholder="opcional"
                      value={m3uUser}
                      onChange={(e) => setM3uUser(e.target.value)}
                      className="bg-white/5 border-white/10 h-11"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="m3u-pass" className="text-xs tracking-wider text-muted-foreground">SENHA (XTREAM)</Label>
                    <Input
                      id="m3u-pass"
                      type="password"
                      placeholder="opcional"
                      value={m3uPass}
                      onChange={(e) => setM3uPass(e.target.value)}
                      className="bg-white/5 border-white/10 h-11"
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={m3uLoading}
                  className="w-full bg-brand-gradient shadow-glow font-semibold h-11"
                >
                  {m3uLoading ? <Loader2 className="size-4 animate-spin" /> : "Carregar Lista M3U"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-foreground"
                  onClick={loadSample}
                >
                  Usar lista de teste (IPTV-Org)
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="text-[11px] text-muted-foreground text-center mt-5">
            Suas credenciais ficam salvas apenas neste navegador.
          </p>
        </div>
      </div>
    </div>
  );
}
