import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Smartphone, User, SlidersHorizontal, PlayCircle, Network, RefreshCw,
  Lock, Gauge, CloudUpload, Tv2, Globe, LifeBuoy,
  Settings2, Eraser, LogOut, ArrowLeft, Plus, Trash2, ChevronRight,
  Upload, Download, CheckCircle2, Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  store, type M3UPlaylist, type ParentalConfig, type AppSettings,
  type AspectRatio, type StreamFormat, type PlayerChoice, type RemoteLayout,
  type ListCompat, type ListUserAgent, type ListTransport, type ListStreamFormat,
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
  const search = Route.useSearch();
  const [focused, setFocused] = useState<TileKey>("language");
  const [open, setOpen] = useState<OpenKey | null>(null);

  useEffect(() => {
    const k = search.open as OpenKey | undefined;
    if (!k) return;
    const valid: OpenKey[] = [
      "app","conta","playerSettings","player","tipoFluxo","parental",
      "teste","backup","remoto","language","socorro","outras",
    ];
    if (valid.includes(k)) {
      setOpen(k);
      setFocused(k as TileKey);
      navigate({ to: "/settings", search: {}, replace: true });
    }
  }, [search.open, navigate]);


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
      <AboutDialog        open={open === "socorro"}        onClose={() => setOpen(null)} />
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
  const [compatIdx, setCompatIdx] = useState<number | null>(null);

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
  const saveCompat = (i: number, compat: ListCompat) => {
    const next = lists.slice();
    next[i] = { ...next[i], compat };
    store.setM3U(next); setLists(next);
    toast.success("Compatibilidade salva");
    setCompatIdx(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Outras configurações</DialogTitle>
          <DialogDescription>
            Gerencie suas listas M3U / M3U8. Use o botão "Avançado" para
            ajustar User-Agent, formato e transporte por lista.
          </DialogDescription>
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
            <div key={i} className="flex items-center justify-between gap-2 bg-white/5 rounded-lg px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{l.name}</div>
                <div className="text-xs text-muted-foreground truncate">{l.url}</div>
                {l.compat && (
                  <div className="text-[10px] text-cyan-300/80 mt-0.5">
                    {compatSummary(l.compat)}
                  </div>
                )}
              </div>
              <button
                onClick={() => setCompatIdx(i)}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
                title="Compatibilidade desta lista"
              >
                <Sliders className="size-3.5" /> Avançado
              </button>
              <button onClick={() => removeList(i)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>

        {compatIdx !== null && lists[compatIdx] && (
          <CompatDialog
            title={`Compatibilidade — ${lists[compatIdx].name}`}
            value={lists[compatIdx].compat ?? {}}
            onClose={() => setCompatIdx(null)}
            onSave={(c) => saveCompat(compatIdx, c)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const UA_LABELS: Record<ListUserAgent, string> = {
  auto: "Automático (testa vários)",
  xciptv: "XCIPTV",
  smarters: "IPTV Smarters",
  tivimate: "TiviMate",
  vlc: "VLC",
  okhttp: "okhttp",
  lavf: "Lavf / FFmpeg",
  chrome: "Chrome Android",
};
const FORMAT_LABELS: Record<ListStreamFormat, string> = {
  auto: "Automático",
  hls: "HLS (.m3u8)",
  ts:  "MPEG-TS (.ts)",
  mp4: "MP4 progressivo",
};
const TRANSPORT_LABELS: Record<ListTransport, string> = {
  auto:   "Automático",
  proxy:  "Sempre via proxy",
  direct: "Sempre direto",
};

function compatSummary(c: ListCompat): string {
  const parts: string[] = [];
  if (c.userAgent && c.userAgent !== "auto") parts.push(`UA: ${UA_LABELS[c.userAgent]}`);
  if (c.streamFormat && c.streamFormat !== "auto") parts.push(FORMAT_LABELS[c.streamFormat]);
  if (c.transport && c.transport !== "auto") parts.push(TRANSPORT_LABELS[c.transport]);
  if (c.forceHttps) parts.push("HTTPS forçado");
  return parts.length ? parts.join(" • ") : "Padrão";
}

function CompatDialog({
  title, value, onClose, onSave,
}: {
  title: string;
  value: ListCompat;
  onClose: () => void;
  onSave: (c: ListCompat) => void;
}) {
  const [draft, setDraft] = useState<ListCompat>(value);
  useEffect(() => { setDraft(value); }, [value]);

  const Section = <T extends string>({
    label, options, current, onPick,
  }: {
    label: string;
    options: { v: T; t: string }[];
    current: T;
    onPick: (v: T) => void;
  }) => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={o.v}
            onClick={() => onPick(o.v)}
            className={`rounded-md px-3 py-2 text-xs text-left border transition ${current === o.v ? "bg-primary/15 border-primary text-white" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
          >
            {o.t}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Ajustes que só valem para os streams deste servidor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <Section<ListUserAgent>
            label="User-Agent enviado ao servidor"
            current={draft.userAgent ?? "auto"}
            onPick={(v) => setDraft({ ...draft, userAgent: v })}
            options={(Object.keys(UA_LABELS) as ListUserAgent[]).map((v) => ({ v, t: UA_LABELS[v] }))}
          />
          <Section<ListStreamFormat>
            label="Formato preferido"
            current={draft.streamFormat ?? "auto"}
            onPick={(v) => setDraft({ ...draft, streamFormat: v })}
            options={(Object.keys(FORMAT_LABELS) as ListStreamFormat[]).map((v) => ({ v, t: FORMAT_LABELS[v] }))}
          />
          <Section<ListTransport>
            label="Transporte"
            current={draft.transport ?? "auto"}
            onPick={(v) => setDraft({ ...draft, transport: v })}
            options={(Object.keys(TRANSPORT_LABELS) as ListTransport[]).map((v) => ({ v, t: TRANSPORT_LABELS[v] }))}
          />
          <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2">
            <div>
              <div className="text-sm">Forçar HTTPS</div>
              <div className="text-xs text-muted-foreground">
                Upgrade http→https antes de tocar (resolve mixed-content).
              </div>
            </div>
            <Switch checked={!!draft.forceHttps} onCheckedChange={(v) => setDraft({ ...draft, forceHttps: v })} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => onSave(draft)} className="bg-brand-gradient">Salvar</Button>
          </div>
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
  const lists = open ? store.getM3U() : [];
  const [info, setInfo] = useState<XtUserInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [creds, setCreds] = useState<ReturnType<typeof store.getCreds>>(null);

  useEffect(() => {
    if (!open) { setInfo(null); setCreds(null); return; }
    const c = store.getCreds();
    setCreds(c);
    if (!c) { setInfo(null); return; }
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const { api } = await import("@/lib/xtream");
        const r = await api<{ user_info?: XtUserInfo }>(c);
        if (alive) setInfo(r?.user_info ?? null);
      } catch {
        if (alive) setInfo(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open]);

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

        {(creds || lists[0]) && (
          <div className="px-6 pb-3">
            <button
              type="button"
              onClick={() => setShowCompat(true)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/10"
            >
              <Sliders className="size-3.5" /> Avançado — Compatibilidade
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full bg-[#b71c3a] py-3 text-center text-sm font-semibold tracking-[0.2em] text-white transition hover:bg-[#9e1632]"
        >
          FECHAR
        </button>

        {showCompat && (
          <CompatDialog
            title={creds ? `Compatibilidade — ${new URL(creds.server).host}` : `Compatibilidade — ${lists[0]?.name ?? "Lista"}`}
            value={creds?.compat ?? lists[0]?.compat ?? {}}
            onClose={() => setShowCompat(false)}
            onSave={(c) => {
              if (creds) {
                store.setCreds({ ...creds, compat: c });
                setCreds({ ...creds, compat: c });
              } else if (lists[0]) {
                const all = store.getM3U();
                all[0] = { ...all[0], compat: c };
                store.setM3U(all);
              }
              toast.success("Compatibilidade salva");
              setShowCompat(false);
            }}
          />
        )}
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

function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
  const [isNative, setIsNative] = useState(false);
  useEffect(() => {
    let alive = true;
    void import("@/lib/xtream").then(({ isNativeApp }) =>
      isNativeApp().then((n) => { if (alive) setIsNative(n); }),
    );
    return () => { alive = false; };
  }, []);

  const playerOptions: { v: PlayerChoice; t: string; d: string }[] = [
    { v: "exo", t: "ExoPlayer", d: "Player nativo do Android — melhor para HLS/DASH ao vivo." },
    { v: "vlc", t: "VLC Player", d: "Abre o stream no app VLC (instale na Play Store)." },
    { v: "internal", t: "Player interno", d: "Reprodutor embutido do app." },
    { v: "external", t: "Outro player externo", d: "Deixa o Android escolher (MX Player, etc)." },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Player Settings</DialogTitle>
          <DialogDescription>Ajustes do reprodutor de vídeo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {isNative && (
            <div>
              <Label className="text-xs text-muted-foreground">Menu Player</Label>
              <div className="mt-2 space-y-2">
                {playerOptions.map((o) => (
                  <button
                    key={o.v}
                    onClick={() => { set({ defaultPlayer: o.v }); toast.success(`Player: ${o.t}`); }}
                    className={`w-full text-left rounded-lg p-3 border transition ${s.defaultPlayer === o.v ? "bg-primary/15 border-primary" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{o.t}</span>
                      {s.defaultPlayer === o.v && <CheckCircle2 className="size-4 text-primary" />}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{o.d}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
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
  const [isNative, setIsNative] = useState(false);
  useEffect(() => {
    let alive = true;
    void import("@/lib/xtream").then(({ isNativeApp }) =>
      isNativeApp().then((n) => { if (alive) setIsNative(n); }),
    );
    return () => { alive = false; };
  }, []);

  const [draft, setDraft] = useState(s.categoryPlayers);
  useEffect(() => { if (open) setDraft(s.categoryPlayers); }, [open, s.categoryPlayers]);

  const rows: { k: keyof typeof draft; label: string }[] = [
    { k: "live",        label: "Live TV" },
    { k: "vod",         label: "VOD" },
    { k: "series",      label: "Series" },
    { k: "catchup",     label: "Catchup" },
    { k: "multiscreen", label: "Multi-Screen" },
  ];

  // Fallback web: mantém o seletor original interno/externo.
  if (!isNative) {
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

  const Radio = ({ checked, color }: { checked: boolean; color: string }) => (
    <span
      className={`inline-flex size-5 items-center justify-center rounded-full border-2 transition`}
      style={{ borderColor: color }}
      aria-hidden
    >
      {checked && <span className="size-2.5 rounded-full" style={{ background: color }} />}
    </span>
  );

  const save = () => {
    set({ categoryPlayers: draft });
    toast.success("Player atualizado");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md border-white/10 bg-[#0b1220] p-0 text-white">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="text-sm font-semibold tracking-[0.25em] text-white/90">
            PLAYER
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Escolha o player por categoria.
          </DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-white/5">
          {rows.map((r) => (
            <div key={r.k} className="flex items-center justify-between px-5 py-3">
              <span className="text-sm text-white/85">{r.label}</span>
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, [r.k]: "exo" })}
                  className="flex items-center gap-2 text-sm"
                >
                  <Radio checked={draft[r.k] === "exo"} color="#22d3ee" />
                  <span className="font-medium text-cyan-300">EXO Player</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, [r.k]: "vlc" })}
                  className="flex items-center gap-2 text-sm"
                >
                  <Radio checked={draft[r.k] === "vlc"} color="#f97316" />
                  <span className="font-medium text-orange-400">VLC Player</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={save}
          className="w-full bg-[#b71c3a] py-3 text-center text-sm font-semibold tracking-[0.3em] text-white transition hover:bg-[#9e1632]"
        >
          OK
        </button>
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
  const abortRef = useRef<AbortController | null>(null);

  const run = async (signal?: AbortSignal) => {
    setRunning(true); setError(null); setResult(null);
    try {
      // Baixa ~2MB de um endpoint de teste pra medir vazão real.
      const url = "https://speed.cloudflare.com/__down?bytes=2000000&t=" + Date.now();
      const t0 = performance.now();
      const res = await fetch(url, { cache: "no-store", signal });
      const buf = await res.arrayBuffer();
      const t1 = performance.now();
      const ms = t1 - t0;
      const bits = buf.byteLength * 8;
      const mbps = bits / (ms / 1000) / 1_000_000;
      if (!signal?.aborted) setResult({ mbps, ms });
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Falha no teste");
    } finally {
      if (!signal?.aborted) setRunning(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setResult(null); setError(null);
    void run(ctrl.signal);
    return () => { ctrl.abort(); };
  }, [open]);

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
        <Button onClick={() => void run()} disabled={running} className="bg-brand-gradient w-full">
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
