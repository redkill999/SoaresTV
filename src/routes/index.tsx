import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tv, Loader2 } from "lucide-react";
import { store } from "@/lib/storage";
import { login } from "@/lib/xtream";
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
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [splash, setSplash] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 900);
    if (store.getCreds()) navigate({ to: "/live" });
    return () => clearTimeout(t);
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const creds = { server, username, password };
    try {
      await login(creds);
      store.setCreds(creds);
      toast.success("Conectado!");
      navigate({ to: "/live" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao conectar");
    } finally {
      setLoading(false);
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
          <p className="text-muted-foreground mt-1 text-sm">Acesse com suas credenciais Xtream</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="glass rounded-2xl p-6 space-y-4 shadow-card border border-white/10"
        >
          <div className="space-y-1.5">
            <Label htmlFor="server">DNS / Servidor</Label>
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
          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-gradient shadow-glow font-semibold h-11"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Entrar"}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Suas credenciais ficam salvas apenas neste dispositivo.
          </p>
        </form>
      </div>
    </div>
  );
}
