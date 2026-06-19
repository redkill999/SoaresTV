import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Smartphone, User, SlidersHorizontal, PlayCircle, Network, RefreshCw,
  Lock, Gauge, CloudUpload, Tv2, Globe, LifeBuoy,
  Settings2, Eraser, LogOut, ArrowLeft, Plus, Trash2, ChevronRight,
  Upload, Download, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  store, type M3UPlaylist, type ParentalConfig, type AppSettings,
  type AspectRatio, type StreamFormat, type PlayerChoice, type RemoteLayout,
} from "@/lib/storage";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { SUPPORTED_LANGS, getStoredLang, setLang, type LangCode } from "@/lib/i18n";
import homeBg from "@/assets/home-bg.png.asset.json";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Ajustes — SoaresTV" }] }),
  validateSearch: (s: Record<string, unknown>) => ({
    open: typeof s.open === "string" ? (s.open as string) : undefined,
  }),
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

type OpenKey = Exclude<TileKey, "atualizar" | "clearCache" | "sair">;

function SettingsPage() {
  const navigate = useNavigate();
  const [focused, setFocused] = useState<TileKey>("language");
  const [open, setOpen] = useState<OpenKey | null>(null);

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
          Object.keys(localStorage)
            .filter((k) => k.startsWith("m3u-cache:") || k.startsWith("xtream-cache:") || k.startsWith("rq-"))
            .forEach((k) => localStorage.removeItem(k));
          toast.success("Cache limpo");
        } catch { toast.error("Falha ao limpar cache"); }
        return;
      case "atualizar":
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith("m3u-cache:") || k.startsWith("xtream-cache:"))
            .forEach((k) => localStorage.removeItem(k));
          toast.success("Conteúdos atualizados");
        } catch { toast.error("Falha ao atualizar"); }
        return;
      default:
        setOpen(k as OpenKey);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[#082968] text-white">
      <Toaster theme="dark" />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${homeBg.url})` }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/35" />

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

      <AppDialog          open={open === "app"}            onClose={() => setOpen(null)} />
      <ContaDialog        open={open === "conta"}          onClose={() => setOpen(null)} />
      <PlayerSettingsDialog open={open === "playerSettings"} onClose={() => setOpen(null)} />
      <PlayerDialog       open={open === "player"}         onClose={() => setOpen(null)} />
      <StreamTypeDialog   open={open === "tipoFluxo"}      onClose={() => setOpen(null)} />
      <ParentalDialog     open={open === "parental"}       onClose={() => setOpen(null)} />
      <SpeedTestDialog    open={open === "teste"}          onClose={() => setOpen(null)} />
      <BackupDialog       open={open === "backup"}         onClose={() => setOpen(null)} />
      <RemoteDialog       open={open === "remoto"}         onClose={() => setOpen(null)} />
      <LanguageDialog     open={open === "language"}       onClose={() => setOpen(null)} />
      <AboutDialog        open={open === "socorro"}        onClose={() => setOpen(null)} kind="socorro" />
      <OutrasDialog       open={open === "outras"}         onClose={() => setOpen(null)} />
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

/* --------------------------- Hooks --------------------------- */

function useAppSettings(): [AppSettings, (p: Partial<AppSettings>) => void] {
  const [s, setS] = useState<AppSettings>(() => store.getAppSettings());
  useEffect(() => store.subscribeAppSettings(() => setS(store.getAppSettings())), []);
  return [s, (p) => store.setAppSettings(p)];
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
              {current === l.code && <CheckCircle2 className="size-4 text-primary" />}
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type XtUserInfo = {
  username?: string;
  message?: string;
  is_trial?: string | number;
  active_cons?: string | number;
  max_connections?: string | number;
  exp_date?: string | number | null;
  status?: string;
  created_at?: string | number;
};

function formatExp(v: XtUserInfo["exp_date"]): string {
  if (v === null || v === undefined || v === "" || v === "0") return "Sem expiração";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n) || n <= 0) return "Sem expiração";
  try {
    return new Date(n * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return String(v);
  }
}

function ContaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const creds = open ? store.getCreds() : null;
  const lists = open ? store.getM3U() : [];
  const [info, setInfo] = useState<XtUserInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !creds) { setInfo(null); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { api } = await import("@/lib/xtream");
        const r = await api<{ user_info?: XtUserInfo }>(creds);
        if (alive) setInfo(r?.user_info ?? null);
      } catch {
        if (alive) setInfo(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, creds]);

  const isTrial = (() => {
    const v = info?.is_trial;
    if (v === undefined || v === null) return null;
    return String(v) === "1" ? "Sim" : "Não";
  })();

  const statusRaw = (info?.status || "").toString().toUpperCase();
  const isActive = statusRaw === "ACTIVE" || statusRaw === "ATIVO";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md overflow-hidden border-white/10 bg-[#0b1220] p-0 text-white">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-base font-semibold tracking-wide text-white">CONTA</DialogTitle>
          <DialogDescription className="text-white/60">Informações da sua conexão.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-6 pb-4 pt-2 text-sm">
          {creds ? (
            loading && !info ? (
              <p className="text-white/60">Carregando informações…</p>
            ) : (
              <>
                <InfoRow label="Nome de usuário" value={info?.username || creds.username} />
                <InfoRow label="Mensagem" value={info?.message || "—"} highlight />
                <InfoRow
                  label="Está no Teste"
                  value={isTrial ?? "—"}
                  highlight={isTrial === "Sim"}
                />
                <InfoRow
                  label="Max Conn"
                  value={`${info?.active_cons ?? "0"} / ${info?.max_connections ?? "—"}`}
                />
                <InfoRow label="Expira" value={formatExp(info?.exp_date ?? null)} />
                <InfoRow
                  label="Status"
                  value={statusRaw || "—"}
                  valueClassName={isActive ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}
                />
              </>
            )
          ) : lists.length > 0 ? (
            <>
              <InfoRow label="Modo" value="Lista M3U" />
              <InfoRow label="Lista" value={lists[0].name} />
              <InfoRow label="URL" value={lists[0].url} mono />
            </>
          ) : (
            <p className="text-white/60">Sem conta conectada.</p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full bg-[#b71c3a] py-3 text-center text-sm font-semibold tracking-[0.2em] text-white transition hover:bg-[#9e1632]"
        >
          FECHAR
        </button>
      </DialogContent>
    </Dialog>
  );
}

function InfoRow({
  label, value, mono, highlight, valueClassName,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 pb-2">
      <span className="text-white/70">{label}</span>
      <span
        className={[
          "max-w-[60%] break-words text-right",
          mono ? "font-mono text-xs" : "",
          highlight ? "text-amber-400" : "text-white",
          valueClassName ?? "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}


function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <Label className="text-muted-foreground text-xs">{label}</Label>
      <div className={`break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}

function AppDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform = typeof navigator !== "undefined" ? navigator.platform : "";
  const lang = typeof navigator !== "undefined" ? navigator.language : "";
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sobre o APP</DialogTitle>
          <DialogDescription>SoaresTV — IPTV Player</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <Row label="Versão" value="1.0.0" />
          <Row label="Plataforma" value={platform || "—"} />
          <Row label="Idioma do sistema" value={lang || "—"} />
          <Row label="User Agent" value={ua || "—"} mono />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AboutDialog({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: "socorro" }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Socorro</DialogTitle>
          <DialogDescription>Precisa de ajuda?</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>Suporte: <a className="text-primary underline" href="mailto:suporte@soarestv.app">suporte@soarestv.app</a></p>
          <p>Site: <a className="text-primary underline" href="https://soarestv.app" target="_blank" rel="noreferrer">soarestv.app</a></p>
          <p className="text-muted-foreground text-xs">{kind}</p>
        </div>
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

function PlayerSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, set] = useAppSettings();
  const ratios: AspectRatio[] = ["default", "16:9", "4:3", "fill", "stretch"];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Player Settings</DialogTitle>
          <DialogDescription>Ajustes do reprodutor de vídeo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <Label className="text-xs text-muted-foreground">Proporção</Label>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {ratios.map((r) => (
                <button
                  key={r}
                  onClick={() => set({ aspectRatio: r })}
                  className={`rounded-md py-2 text-xs border transition ${s.aspectRatio === r ? "bg-primary text-primary-foreground border-primary" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                >{r}</button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Tamanho da legenda ({s.subtitleScale.toFixed(2)}x)</Label>
            <Slider value={[s.subtitleScale]} min={0.75} max={2} step={0.05} onValueChange={([v]) => set({ subtitleScale: v })} className="mt-2" />
          </div>
          <Toggle label="Aceleração por hardware" value={s.hwAccel} onChange={(v) => set({ hwAccel: v })} />
          <Toggle label="Auto-play próximo episódio" value={s.autoplayNext} onChange={(v) => set({ autoplayNext: v })} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlayerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, set] = useAppSettings();
  const options: { v: PlayerChoice; t: string; d: string }[] = [
    { v: "internal", t: "Player interno", d: "Reprodutor nativo do app (HLS/MP4)." },
    { v: "external", t: "Player externo", d: "Abre o stream no MX/VLC (Android)." },
  ];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Player</DialogTitle>
          <DialogDescription>Escolha o reprodutor padrão.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {options.map((o) => (
            <button
              key={o.v}
              onClick={() => { set({ defaultPlayer: o.v }); toast.success(`Player: ${o.t}`); onClose(); }}
              className={`w-full text-left rounded-lg p-3 border transition ${s.defaultPlayer === o.v ? "bg-primary/15 border-primary" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{o.t}</span>
                {s.defaultPlayer === o.v && <CheckCircle2 className="size-4 text-primary" />}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{o.d}</div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StreamTypeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, set] = useAppSettings();
  const opts: { v: StreamFormat; t: string; d: string }[] = [
    { v: "auto", t: "Automático", d: "Detecta HLS/TS automaticamente." },
    { v: "hls",  t: "HLS (.m3u8)", d: "Prefere variante HLS quando disponível." },
    { v: "ts",   t: "MPEG-TS (.ts)", d: "Força fluxo TS bruto." },
    { v: "mp4",  t: "MP4 progressivo", d: "Força MP4 direto." },
  ];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tipo de fluxo</DialogTitle>
          <DialogDescription>Formato preferido para streams ao vivo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {opts.map((o) => (
            <button
              key={o.v}
              onClick={() => { set({ streamFormat: o.v }); toast.success(`Fluxo: ${o.t}`); onClose(); }}
              className={`w-full text-left rounded-lg p-3 border transition ${s.streamFormat === o.v ? "bg-primary/15 border-primary" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{o.t}</span>
                {s.streamFormat === o.v && <CheckCircle2 className="size-4 text-primary" />}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{o.d}</div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SpeedTestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ mbps: number; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true); setError(null); setResult(null);
    try {
      // Baixa ~2MB de um endpoint de teste pra medir vazão real.
      const url = "https://speed.cloudflare.com/__down?bytes=2000000&t=" + Date.now();
      const t0 = performance.now();
      const res = await fetch(url, { cache: "no-store" });
      const buf = await res.arrayBuffer();
      const t1 = performance.now();
      const ms = t1 - t0;
      const bits = buf.byteLength * 8;
      const mbps = bits / (ms / 1000) / 1_000_000;
      setResult({ mbps, ms });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no teste");
    } finally { setRunning(false); }
  };

  useEffect(() => { if (open) { setResult(null); setError(null); void run(); } }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Teste rápido</DialogTitle>
          <DialogDescription>Medida da velocidade de download.</DialogDescription>
        </DialogHeader>
        <div className="py-4 text-center">
          {running && <div className="text-sm text-muted-foreground animate-pulse">Medindo…</div>}
          {error && <div className="text-sm text-destructive">{error}</div>}
          {result && (
            <div>
              <div className="text-4xl font-bold tabular-nums">{result.mbps.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">Mbps</span></div>
              <div className="text-xs text-muted-foreground mt-1">latência ~{result.ms.toFixed(0)} ms</div>
            </div>
          )}
        </div>
        <Button onClick={run} disabled={running} className="bg-brand-gradient w-full">
          {running ? "Testando…" : "Refazer teste"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function BackupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  const exportAll = () => {
    try {
      const data: Record<string, string | null> = {};
      Object.keys(localStorage).forEach((k) => (data[k] = localStorage.getItem(k)));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `soarestv-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Backup gerado");
    } catch { toast.error("Falha no backup"); }
  };

  const importFile = async (f: File) => {
    try {
      const txt = await f.text();
      const data = JSON.parse(txt) as Record<string, string>;
      Object.entries(data).forEach(([k, v]) => { if (typeof v === "string") localStorage.setItem(k, v); });
      toast.success("Restauração concluída — recarregue o app");
      setTimeout(() => location.reload(), 800);
    } catch { toast.error("Arquivo inválido"); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Backup e restauração</DialogTitle>
          <DialogDescription>Exporte ou restaure suas listas, favoritos e ajustes.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Button onClick={exportAll} className="bg-brand-gradient">
            <Download className="size-4" /> Exportar
          </Button>
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" /> Restaurar
          </Button>
        </div>
        <input
          ref={inputRef} type="file" accept="application/json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }}
        />
      </DialogContent>
    </Dialog>
  );
}

function RemoteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, set] = useAppSettings();
  const opts: { v: RemoteLayout; t: string; d: string }[] = [
    { v: "default", t: "Padrão",  d: "Otimizado para toque." },
    { v: "compact", t: "Compacto", d: "Botões menores para tablets." },
    { v: "tv",      t: "TV",       d: "Foco navegável via setas do controle remoto." },
  ];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Controle remoto</DialogTitle>
          <DialogDescription>Layout de navegação por controle.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {opts.map((o) => (
            <button
              key={o.v}
              onClick={() => { set({ remoteLayout: o.v }); toast.success(`Layout: ${o.t}`); onClose(); }}
              className={`w-full text-left rounded-lg p-3 border transition ${s.remoteLayout === o.v ? "bg-primary/15 border-primary" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{o.t}</span>
                {s.remoteLayout === o.v && <CheckCircle2 className="size-4 text-primary" />}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{o.d}</div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}
