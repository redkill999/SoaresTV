import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import {
  Smartphone, User, SlidersHorizontal, PlayCircle, Network, RefreshCw,
  Lock, Gauge, CloudUpload, Tv2, Globe, LifeBuoy,
  Settings2, Eraser, LogOut, ArrowLeft, Plus, Trash2, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { store, type M3UPlaylist, type ParentalConfig } from "@/lib/storage";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { useTranslation } from "react-i18next";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { SUPPORTED_LANGS, getStoredLang, setLang, type LangCode } from "@/lib/i18n";
import homeBg from "@/assets/home-bg.png.asset.json";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Ajustes — SoaresTV" }] }),
  component: SettingsPage,
});

type TileKey =
  | "app" | "conta" | "playerSettings" | "player" | "tipoFluxo" | "atualizar"
  | "parental" | "teste" | "backup" | "remoto" | "language" | "socorro"
  | "outras" | "clearCache" | "sair";

type Tile = {
  key: TileKey;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  sub?: string;
};

const TILES: Tile[] = [
  { key: "app",             label: "APP",                  icon: Smartphone },
  { key: "conta",           label: "Conta",                icon: User },
  { key: "playerSettings",  label: "Player Settings",      icon: SlidersHorizontal },
  { key: "player",          label: "Player",               icon: PlayCircle },
  { key: "tipoFluxo",       label: "Tipo de fluxo",        icon: Network },
  { key: "atualizar",       label: "Atualizar\nConteúdos", icon: RefreshCw },
  { key: "parental",        label: "Parental",             icon: Lock },
  { key: "teste",           label: "Teste rápido",         icon: Gauge },
  { key: "backup",          label: "Backup e\nrestauração",icon: CloudUpload },
  { key: "remoto",          label: "Controle remoto",      icon: Tv2 },
  { key: "language",        label: "Language",             icon: Globe },
  { key: "socorro",         label: "Socorro",              icon: LifeBuoy },
  { key: "outras",          label: "OUTRAS\nCONFIGURAÇÕES",icon: Settings2 },
  { key: "clearCache",      label: "Clear Cache",          icon: Eraser },
  { key: "sair",            label: "Sair",                 icon: LogOut },
];

function SettingsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [focused, setFocused] = useState<TileKey>("language");
  const [open, setOpen] = useState<null | "outras" | "language" | "conta" | "app" | "socorro" | "parental">(null);

  // Aplica o mesmo fundo da home no letterbox do TV-mode
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevH = html.style.background;
    const prevB = body.style.background;
    const bg = `url(${homeBg.url}) center/cover no-repeat #082968`;
    html.style.background = bg;
    body.style.background = bg;
    return () => { html.style.background = prevH; body.style.background = prevB; };
  }, []);

  const handle = (k: TileKey) => {
    setFocused(k);
    switch (k) {
      case "sair":
        store.setCreds(null);
        store.setM3U([]);
        navigate({ to: "/", replace: true });
        return;
      case "clearCache":
        try {
          // limpa apenas caches de conteúdo, preserva credenciais/listas
          Object.keys(localStorage)
            .filter((k) => k.startsWith("m3u-cache:") || k.startsWith("xtream-cache:") || k.startsWith("rq-"))
            .forEach((k) => localStorage.removeItem(k));
          toast.success("Cache limpo");
        } catch {
          toast.error("Falha ao limpar cache");
        }
        return;
      case "atualizar":
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith("m3u-cache:") || k.startsWith("xtream-cache:"))
            .forEach((k) => localStorage.removeItem(k));
          toast.success("Conteúdos atualizados");
        } catch {
          toast.error("Falha ao atualizar");
        }
        return;
      case "backup": {
        try {
          const data: Record<string, unknown> = {};
          Object.keys(localStorage).forEach((k) => (data[k] = localStorage.getItem(k)));
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `soarestv-backup-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          toast.success("Backup gerado");
        } catch {
          toast.error("Falha no backup");
        }
        return;
      }
      case "outras":
      case "language":
      case "conta":
      case "app":
      case "socorro":
      case "parental":
        setOpen(k);
        return;
      default:
        toast("Em breve", { description: TILES.find((t) => t.key === k)?.label.replace("\n", " ") });
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#082968] text-white">
      <Toaster theme="dark" />

      {/* Fundo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${homeBg.url})` }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/35" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <button
          onClick={() => navigate({ to: "/home" })}
          className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-white/80 hover:bg-white/10 border border-white/10"
          aria-label="Voltar"
        >
          <ArrowLeft className="size-4" /> Home
        </button>
        <h1 className="font-display text-sm sm:text-base tracking-[0.5em] text-white/85">
          S E T T I N G S
        </h1>
        <span className="size-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" aria-hidden />
      </header>

      {/* Grade de tiles */}
      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-4 pb-6">
        <div className="grid w-full grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 md:grid-cols-6">
          {TILES.map((tile) => (
            <SettingsTile
              key={tile.key}
              tile={tile}
              focused={focused === tile.key}
              onClick={() => handle(tile.key)}
            />
          ))}
        </div>
      </main>

      <OutrasDialog open={open === "outras"} onClose={() => setOpen(null)} />
      <LanguageDialog open={open === "language"} onClose={() => setOpen(null)} />
      <ContaDialog open={open === "conta"} onClose={() => setOpen(null)} />
      <AboutDialog
        open={open === "app" || open === "socorro"}
        onClose={() => setOpen(null)}
        kind={open === "socorro" ? "socorro" : "app"}
      />
      <ParentalDialog open={open === "parental"} onClose={() => setOpen(null)} />
    </div>
  );
}

function SettingsTile({
  tile, focused, onClick,
}: { tile: Tile; focused: boolean; onClick: () => void }) {
  const Icon = tile.icon;
  return (
    <button
      onClick={onClick}
      onFocus={onClick}
      className={[
        "group relative flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl",
        "bg-[#0b1a3d]/85 p-3 text-white/85 transition",
        "hover:bg-[#11245a]/90 focus:outline-none",
        focused
          ? "ring-2 ring-cyan-400 shadow-[0_0_0_2px_rgba(34,211,238,0.6),0_8px_30px_-8px_rgba(34,211,238,0.6)]"
          : "ring-1 ring-white/5",
      ].join(" ")}
    >
      <Icon className="size-9 sm:size-10 text-white/80" strokeWidth={1.6} />
      <span className="whitespace-pre-line text-center text-[11px] sm:text-xs font-medium leading-tight text-white/85">
        {tile.label}
      </span>
    </button>
  );
}

/* --------------------------- Dialogs --------------------------- */

function OutrasDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [lists, setLists] = useState<M3UPlaylist[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => { if (open) setLists(store.getM3U()); }, [open]);

  const addList = () => {
    if (!name || !url) return;
    const next = [...lists, { name, url }];
    store.setM3U(next); setLists(next); setName(""); setUrl("");
    toast.success("Lista M3U adicionada");
  };
  const removeList = (i: number) => {
    const next = lists.filter((_, idx) => idx !== i);
    store.setM3U(next); setLists(next);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Outras configurações</DialogTitle>
          <DialogDescription>Gerencie suas listas M3U / M3U8.</DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-[1fr_2fr_auto] gap-2 mb-3">
          <Input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} className="bg-white/5 border-white/10" />
          <Input placeholder="URL .m3u" value={url} onChange={(e) => setUrl(e.target.value)} className="bg-white/5 border-white/10" />
          <Button onClick={addList} className="bg-brand-gradient">
            <Plus className="size-4" /> Adicionar
          </Button>
        </div>

        <div className="space-y-2 max-h-72 overflow-auto">
          {lists.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma lista.</p>}
          {lists.map((l, i) => (
            <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">{l.name}</div>
                <div className="text-xs text-muted-foreground truncate">{l.url}</div>
              </div>
              <button onClick={() => removeList(i)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LanguageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState<LangCode>("pt");
  useEffect(() => { if (open) setCurrent(getStoredLang()); }, [open]);
  const pick = (c: LangCode) => { setCurrent(c); setLang(c); toast.success("Idioma alterado"); onClose(); };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Language</DialogTitle>
          <DialogDescription>Escolha o idioma do app.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {SUPPORTED_LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => pick(l.code)}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/5 ${current === l.code ? "bg-white/5" : ""}`}
            >
              <span className="text-xl leading-none">{l.flag}</span>
              <span className="flex-1 text-sm font-medium">{l.label}</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const creds = open ? store.getCreds() : null;
  const lists = open ? store.getM3U() : [];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conta</DialogTitle>
          <DialogDescription>Informações da sua conexão atual.</DialogDescription>
        </DialogHeader>
        {creds ? (
          <div className="space-y-2 text-sm">
            <div><Label className="text-muted-foreground">Servidor</Label><div className="font-mono text-xs break-all">{creds.host}</div></div>
            <div><Label className="text-muted-foreground">Usuário</Label><div>{creds.username}</div></div>
          </div>
        ) : lists.length > 0 ? (
          <div className="text-sm">
            Você está usando lista M3U: <span className="font-medium">{lists[0].name}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sem conta conectada.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AboutDialog({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: "app" | "socorro" }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === "app" ? "Sobre o APP" : "Socorro"}</DialogTitle>
          <DialogDescription>
            {kind === "app"
              ? "SoaresTV — IPTV web player. Dados armazenados localmente no seu navegador."
              : "Precisa de ajuda? Entre em contato pelo site soarestv.app."}
          </DialogDescription>
        </DialogHeader>
        <div className="text-xs text-muted-foreground">Versão 1.0.0</div>
      </DialogContent>
    </Dialog>
  );
}

function ParentalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [parental, setParental] = useState<ParentalConfig>({ pin: null, lockedCategories: [] });
  const [pin, setPin] = useState("");
  useEffect(() => { if (open) setParental(store.getParental()); }, [open]);
  const savePin = () => {
    const next = { ...parental, pin: pin || null };
    store.setParental(next); setParental(next); setPin("");
    toast.success(pin ? "PIN definido" : "PIN removido");
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Controle parental</DialogTitle>
          <DialogDescription>
            {parental.pin ? "PIN definido." : "Nenhum PIN."} Deixe vazio para remover.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            type="password" inputMode="numeric" maxLength={6}
            placeholder="Novo PIN"
            value={pin} onChange={(e) => setPin(e.target.value)}
            className="bg-white/5 border-white/10"
          />
          <Button onClick={savePin} className="bg-brand-gradient">Salvar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
