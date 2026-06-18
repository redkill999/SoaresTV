import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tv, Loader2, ListVideo, PlayCircle } from "lucide-react";
import { store } from "@/lib/storage";
import { api, login, streamUrl, loadM3U } from "@/lib/xtream";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

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
      setTimeout(() => navigate({ to: "/live" }), 600);
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
    setM3uLoading(true);
    try {
      const entries = await loadM3U(m3uUrl);
      if (!entries.length) throw new Error("Lista vazia");
      const lists = store.getM3U();
      const exists = lists.find((l) => l.url === m3uUrl);
      if (!exists) store.setM3U([...lists, { name: m3uName || "Lista M3U", url: m3uUrl }]);
      toast.success(`${entries.length} canais carregados`);
      navigate({ to: "/playlist", search: { url: m3uUrl, name: m3uName || "Lista M3U" } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar M3U");
    } finally {
      setM3uLoading(false);
    }
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
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <Toaster theme="dark" />
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 size-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 size-96 rounded-full bg-accent/20 blur-3xl" />
      </div>

      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="size-16 rounded-2xl bg-brand-gradient shadow-glow mx-auto mb-4 flex items-center justify-center">
            <Tv className="size-8 text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            <span className="text-brand-gradient">SoaresTV</span>
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Entre com Xtream Codes ou uma lista M3U
          </p>
        </div>

        <div className="glass rounded-2xl p-6 shadow-card border border-white/10">
          <Tabs defaultValue="xtream">
            <TabsList className="grid grid-cols-2 w-full bg-white/5 mb-4">
              <TabsTrigger value="xtream">
                <Tv className="size-4 mr-1.5" /> Xtream
              </TabsTrigger>
              <TabsTrigger value="m3u">
                <ListVideo className="size-4 mr-1.5" /> M3U
              </TabsTrigger>
            </TabsList>

            <TabsContent value="xtream">
              <form onSubmit={onXtream} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="server">DNS</Label>
                  <Input
                    id="server"
                    required
                    placeholder="http://meu-servidor.com:8080"
                    value={server}
                    onChange={(e) => setServer(e.target.value)}
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user">Usuário</Label>
                  <Input
                    id="user"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pass">Senha</Label>
                  <Input
                    id="pass"
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-white/5 border-white/10"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="submit"
                    disabled={loading}
                    className="bg-brand-gradient shadow-glow font-semibold h-11"
                  >
                    {loading ? <Loader2 className="size-4 animate-spin" /> : "Entrar Xtream"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11"
                    onClick={playFirstChannel}
                  >
                    <PlayCircle className="size-4 mr-1.5" />
                    Reproduzir
                  </Button>
                </div>

                {result && (
                  <pre className="mt-3 max-h-48 overflow-auto text-[10px] bg-black/40 border border-white/10 rounded-lg p-3 text-muted-foreground whitespace-pre-wrap break-all">
                    {result}
                  </pre>
                )}
              </form>
            </TabsContent>

            <TabsContent value="m3u">
              <form onSubmit={onM3U} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="m3u-name">Nome da lista</Label>
                  <Input
                    id="m3u-name"
                    placeholder="Minha lista"
                    value={m3uName}
                    onChange={(e) => setM3uName(e.target.value)}
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="m3u-url">URL .m3u / .m3u8</Label>
                  <Input
                    id="m3u-url"
                    required
                    placeholder="https://exemplo.com/lista.m3u"
                    value={m3uUrl}
                    onChange={(e) => setM3uUrl(e.target.value)}
                    className="bg-white/5 border-white/10"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={m3uLoading}
                  className="w-full bg-brand-gradient shadow-glow font-semibold h-11"
                >
                  {m3uLoading ? <Loader2 className="size-4 animate-spin" /> : "Carregar Lista M3U"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="text-[11px] text-muted-foreground text-center mt-4">
            Suas credenciais e listas ficam salvas apenas neste dispositivo.
          </p>
        </div>
      </div>
    </div>
  );
}
