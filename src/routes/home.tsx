import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Tv, CalendarDays, Film, Clapperboard,
  User, LayoutGrid, RotateCcw,
  Star, Radio, Settings as SettingsIcon,
  AlarmClock, Video, Lock, Mail, RefreshCw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { store, type M3UPlaylist, type HistItem } from "@/lib/storage";
import { xtreamCredsFromUrl } from "@/lib/xtream";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import homeBg from "@/assets/home-bg.png.asset.json";

export const Route = createFileRoute("/home")({
  component: HomePage,
});

type Tile = {
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  to: string;
};

const MAIN: Tile[] = [
  { label: "TV AO VIVO", icon: Tv, to: "/live" },
  { label: "EPG", icon: CalendarDays, to: "/guide" },
  { label: "FILMES", icon: Film, to: "/movies" },
  { label: "SÉRIES", icon: Clapperboard, to: "/series" },
];

const BOTTOM_LEFT: Tile[] = [
  { label: "CONTA", icon: User, to: "/settings" },
  { label: "MULTI", icon: LayoutGrid, to: "/live" },
  { label: "CATCH UP", icon: RotateCcw, to: "/live" },
];

const BOTTOM_RIGHT: Tile[] = [
  { label: "FAVORITOS", icon: Star, to: "/favorites" },
  { label: "RÁDIO", icon: Radio, to: "/live" },
  { label: "CONFIGURAÇÃO", icon: SettingsIcon, to: "/settings" },
];


type StatusKey = "alarm" | "rec" | "vpn" | "msg" | "update";

function HomePage() {
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [m3uList, setM3uList] = useState<M3UPlaylist | null>(null);
  const [openConta, setOpenConta] = useState(false);

  // status state
  const [openStatus, setOpenStatus] = useState<StatusKey | null>(null);
  const [recOn, setRecOn] = useState(false);
  const [alarmMin, setAlarmMin] = useState(0);
  const alarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
    const hasCreds = !!store.getCreds();
    const playlists = store.getM3U();
    setM3uList(playlists[0] ?? null);
    if (!hasCreds && playlists.length === 0) navigate({ to: "/" });
  }, [navigate]);

  // Pinta o "letterbox" do TV-mode com a mesma imagem da home,
  // pra não sobrar barra preta em cima/embaixo no preview.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    const bg = `url(${homeBg.url}) center/100% 100% no-repeat #082968`;
    html.style.background = bg;
    body.style.background = bg;
    return () => {
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
    };
  }, []);

  // limpa o sleep-timer ao desmontar
  useEffect(() => () => {
    if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
  }, []);

  if (!mounted) return <HomeSkeleton />;

  const openTile = (to: string, label?: string) => {
    if (label === "CONTA") { setOpenConta(true); return; }
    if (!to) return;
    const usesPlaylistContent = to === "/live" || to === "/movies" || to === "/series";
    if (m3uList && !store.getCreds() && usesPlaylistContent) {
      const xtreamCreds = xtreamCredsFromUrl(m3uList.url, m3uList.username, m3uList.password);
      if (xtreamCreds) {
        store.setCreds(xtreamCreds);
        navigate({ to });
        return;
      }
      navigate({ to: "/playlist", search: { url: m3uList.url, name: m3uList.name } });
      return;
    }
    navigate({ to });
  };




  const setSleepTimer = (mins: number) => {
    if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
    setAlarmMin(mins);
    if (mins <= 0) {
      toast.success("Alarme desligado");
      setOpenStatus(null);
      return;
    }
    alarmTimerRef.current = setTimeout(() => {
      toast("Sleep timer", { description: "Tempo encerrado, voltando ao login." });
      store.setCreds(null);
      navigate({ to: "/", replace: true });
    }, mins * 60_000);
    toast.success(`Alarme: ${mins} min`);
    setOpenStatus(null);
  };

  const toggleRec = () => {
    const next = !recOn;
    setRecOn(next);
    toast.success(next ? "Gravação iniciada" : "Gravação parada");
  };

  const runUpdate = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("m3u-cache:") || k.startsWith("xtream-cache:") || k.startsWith("rq-"))
        .forEach((k) => localStorage.removeItem(k));
      toast.success("Conteúdos atualizados");
      setTimeout(() => navigate({ to: "/loading", replace: true }), 300);
    } catch {
      toast.error("Falha ao atualizar");
    }
  };

  const handleStatus = (k: StatusKey) => {
    if (k === "rec")    return toggleRec();
    if (k === "update") return runUpdate();
    setOpenStatus(k);
  };


  return (
    <div className="relative flex h-dvh max-h-dvh flex-col overflow-hidden bg-[#082968] text-white">
      {/* Background image — stretched to fill so toda a arte aparece igual ao desktop,
          sem corte nas bordas em celular/TV (cover cortaria as laterais ou topo/base). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-no-repeat bg-center"
        style={{ backgroundImage: `url(${homeBg.url})`, backgroundSize: "100% 100%" }}
      />
      {/* Subtle darken to keep tiles readable */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black/25"
      />


      {/* Top bar */}
      <header className="relative z-10 flex items-start justify-between gap-2 px-3 pt-3 sm:px-6 sm:pt-5">
        <div className="hidden sm:block w-40 shrink-0" />
        <div className="flex flex-col items-center min-w-0">
          <div className="grid size-11 sm:size-14 place-items-center rounded-full bg-white/10 ring-2 ring-white/30 backdrop-blur">
            <Tv className="size-5 sm:size-7 text-white" strokeWidth={2.2} />
          </div>
          <div className="mt-1 font-display text-[10px] sm:text-[11px] font-bold tracking-[0.3em] sm:tracking-[0.35em] text-white/90">
            SOARES TV
          </div>
        </div>
        <div className="flex flex-wrap items-start justify-end gap-x-1.5 gap-y-1 sm:gap-2.5 sm:w-40 shrink-0 max-w-[55%]">
          <StatusIcon icon={AlarmClock} label="ALARM"  active={alarmMin > 0} activeColor="bg-emerald-400" onClick={() => handleStatus("alarm")} />
          <StatusIcon icon={Video}      label="REC"    active={recOn}        activeColor="bg-red-500"     onClick={() => handleStatus("rec")} />
          <StatusIcon icon={Lock}       label="VPN"                                                       onClick={() => handleStatus("vpn")} />
          <StatusIcon icon={Mail}       label="MSG"                                                       onClick={() => handleStatus("msg")} />
          <StatusIcon icon={RefreshCw}  label="UPDATE"                                                    onClick={() => handleStatus("update")} />
        </div>
      </header>

      {/* Main 4 tiles */}
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 min-h-0 items-center justify-center px-4 py-2">
        <div className="grid w-full grid-cols-2 gap-3 sm:gap-5 md:grid-cols-4">
          {MAIN.map((t, i) => (
            <MainTile key={t.label} tile={t} onClick={() => openTile(t.to, t.label)} defaultFocus={i === 0} />
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 grid grid-cols-3 items-end gap-3 px-4 pb-3 pt-1 sm:px-6 sm:pb-5">
        <div className="flex items-end gap-2 sm:gap-3">
          {BOTTOM_LEFT.map((t) => (
            <SmallTile key={t.label} tile={t} onClick={() => openTile(t.to, t.label)} />
          ))}
        </div>
        <div className="flex flex-col items-center justify-end pb-1 text-center">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/70">
            <Tv className="size-3.5" />
            <span>Desenvolvido por</span>
          </div>
          <div className="text-[11px] font-semibold tracking-[0.2em] text-white/90">
            RedKiLL999
          </div>
        </div>
        <div className="flex items-end justify-end gap-2 sm:gap-3">
          {BOTTOM_RIGHT.map((t) => (
            <SmallTile key={t.label} tile={t} onClick={() => openTile(t.to, t.label)} />
          ))}
        </div>
      </footer>

      <Toaster theme="dark" />

      {/* Status dialogs */}
      <AlarmDialog
        open={openStatus === "alarm"}
        onClose={() => setOpenStatus(null)}
        current={alarmMin}
        onPick={setSleepTimer}
      />
      <VpnDialog open={openStatus === "vpn"} onClose={() => setOpenStatus(null)} />
      <MsgDialog open={openStatus === "msg"} onClose={() => setOpenStatus(null)} />
      <ContaDialog open={openConta} onClose={() => setOpenConta(false)} />
    </div>
  );
}



function MainTile({ tile, onClick, defaultFocus }: { tile: Tile; onClick: () => void; defaultFocus?: boolean }) {
  const Icon = tile.icon;
  return (
    <button
      onClick={onClick}
      data-tv-default-focus={defaultFocus ? "" : undefined}
      className="group mx-auto flex w-full max-w-[180px] flex-col items-center justify-center gap-1.5 rounded-xl border border-white/70 bg-white/[0.04] px-3 py-3 sm:px-4 sm:py-5 text-white transition hover:bg-white/10 hover:border-white focus:outline-none focus:ring-2 focus:ring-white/60"
    >
      <Icon className="size-8 sm:size-12 transition group-hover:scale-105" strokeWidth={1.6} />
      <span className="text-xs sm:text-base font-semibold tracking-[0.16em] sm:tracking-[0.18em]">{tile.label}</span>
    </button>
  );
}

function SmallTile({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  const Icon = tile.icon;
  return (
    <button
      onClick={onClick}
      className="flex aspect-square w-[56px] flex-col items-center justify-center gap-1 rounded-lg border border-white/80 bg-white/[0.03] text-white transition hover:bg-white/10 sm:w-[78px]"
    >
      <Icon className="size-5 sm:size-7" strokeWidth={1.7} />
      <span className="text-[8px] font-semibold tracking-widest sm:text-[10px]">{tile.label}</span>
    </button>
  );
}

function StatusIcon({
  icon: Icon,
  label,
  onClick,
  active = false,
  activeColor = "bg-emerald-400",
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  label: string;
  onClick?: () => void;
  active?: boolean;
  activeColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="relative flex flex-col items-center gap-0.5 text-white/85 hover:text-white transition-colors focus:outline-none"
    >
      <Icon className="size-5" strokeWidth={1.8} />
      <span className="text-[8px] font-semibold tracking-wider">{label}</span>
      {active && (
        <span className={`absolute -top-0.5 -right-0.5 size-1.5 rounded-full ${activeColor} shadow-[0_0_6px_rgba(255,255,255,0.6)]`} />
      )}
    </button>
  );
}

/* -------- Status dialogs -------- */

function AlarmDialog({
  open, onClose, current, onPick,
}: { open: boolean; onClose: () => void; current: number; onPick: (m: number) => void }) {
  const opts = [0, 15, 30, 60, 90, 120];
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sleep timer</DialogTitle>
          <DialogDescription>Desliga o app automaticamente após o tempo escolhido.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2">
          {opts.map((m) => (
            <button
              key={m}
              onClick={() => onPick(m)}
              className={`rounded-lg border py-2 text-sm transition ${current === m ? "bg-primary text-primary-foreground border-primary" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
            >
              {m === 0 ? "Desligado" : `${m} min`}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VpnDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [ip, setIp] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setIp(null); setErr(null);
    fetch("https://api.ipify.org?format=json")
      .then((r) => r.json())
      .then((d: { ip: string }) => setIp(d.ip))
      .catch(() => setErr("Sem conexão"));
  }, [open]);
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>VPN / Conexão</DialogTitle>
          <DialogDescription>Status atual da sua conexão.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className={online ? "text-emerald-400" : "text-red-400"}>{online ? "Online" : "Offline"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">IP público</span>
            <span className="font-mono">{ip ?? (err ?? "...")}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MsgDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<HistItem[]>([]);
  useEffect(() => { if (open) setItems(store.getHistory().slice(0, 8)); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mensagens</DialogTitle>
          <DialogDescription>Atividade recente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-72 overflow-auto">
          <div className="rounded-lg bg-white/5 px-3 py-2 text-sm">
            <div className="font-medium">Bem-vindo ao SoaresTV</div>
            <div className="text-xs text-muted-foreground">App pronto para uso. Versão 1.0.0</div>
          </div>
          {items.length === 0 && <p className="text-xs text-muted-foreground">Sem atividade ainda.</p>}
          {items.map((it) => (
            <div key={`${it.type}:${it.id}`} className="rounded-lg bg-white/5 px-3 py-2 text-sm">
              <div className="font-medium truncate">{it.name}</div>
              <div className="text-xs text-muted-foreground">
                {it.type.toUpperCase()} • {new Date(it.at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#0a3a8c] p-6">
      <div className="mb-8 flex items-center justify-between">
        <Skeleton className="h-10 w-32 bg-white/10" />
        <Skeleton className="h-14 w-14 rounded-full bg-white/10" />
        <Skeleton className="h-10 w-32 bg-white/10" />
      </div>
      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-2 items-center gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-2xl bg-white/10" />
        ))}
      </div>
    </div>
  );
}

/* -------- Conta Dialog -------- */

type XtUserInfo = {
  username?: string;
  message?: string;
  is_trial?: string | number;
  active_cons?: string | number;
  max_connections?: string | number;
  exp_date?: string | number | null;
  status?: string;
};

function formatExp(v: XtUserInfo["exp_date"]): string {
  if (v === null || v === undefined || v === "" || v === "0") return "Sem expiração";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n) || (n as number) <= 0) return "Sem expiração";
  try {
    return new Date((n as number) * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return String(v);
  }
}

function ContaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<XtUserInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasCreds, setHasCreds] = useState(false);

  useEffect(() => {
    if (!open) return;
    const creds = store.getCreds();
    setHasCreds(!!creds);
    if (!creds) { setInfo(null); return; }
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
          <DialogTitle className="text-base font-semibold tracking-[0.2em] text-white">CONTA</DialogTitle>
          <DialogDescription className="text-white/60">Informações da sua conexão.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 px-6 pb-4 pt-2 text-sm">
          {!hasCreds ? (
            <p className="text-white/60">Sem conta Xtream conectada.</p>
          ) : loading && !info ? (
            <p className="text-white/60">Carregando informações…</p>
          ) : (
            <>
              <ContaRow label="Nome de usuário" value={info?.username || "—"} />
              <ContaRow label="Mensagem" value={info?.message || "—"} highlight />
              <ContaRow label="Está no Teste" value={isTrial ?? "—"} highlight={isTrial === "Sim"} />
              <ContaRow label="Max Conn" value={`${info?.active_cons ?? "0"} / ${info?.max_connections ?? "—"}`} />
              <ContaRow label="Expira" value={formatExp(info?.exp_date ?? null)} />
              <ContaRow
                label="Status"
                value={statusRaw || "—"}
                valueClassName={isActive ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}
              />
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full bg-[#b71c3a] py-3 text-center text-sm font-semibold tracking-[0.25em] text-white transition hover:bg-[#9e1632]"
        >
          FECHAR
        </button>
      </DialogContent>
    </Dialog>
  );
}

function ContaRow({
  label, value, highlight, valueClassName,
}: { label: string; value: string; highlight?: boolean; valueClassName?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 pb-2">
      <span className="text-white/70">{label}</span>
      <span
        className={[
          "max-w-[60%] break-words text-right",
          highlight ? "text-amber-400" : "text-white",
          valueClassName ?? "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
