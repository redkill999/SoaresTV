import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ComponentType } from "react";
import {
  Tv, CalendarDays, Film, Clapperboard,
  User, LayoutGrid, RotateCcw,
  Star, Radio, Settings as SettingsIcon,
  AlarmClock, Video, Lock, Mail, RefreshCw,
} from "lucide-react";

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
  { label: "FILMES", icon: Film, to: "/movies" },
  { label: "SÉRIES", icon: Clapperboard, to: "/series" },
  { label: "EPG", icon: CalendarDays, to: "/guide" },
];

const BOTTOM: Tile[] = [
  { label: "CONTA", icon: User, to: "/settings" },
  { label: "FAVORITOS", icon: Star, to: "/favorites" },
  { label: "RÁDIO", icon: Radio, to: "/live" },
  { label: "CONFIG", icon: SettingsIcon, to: "/settings" },
  { label: "CATCH UP", icon: RotateCcw, to: "/live" },
  { label: "MULTI", icon: LayoutGrid, to: "/live" },
];


type StatusKey = "alarm" | "rec" | "vpn" | "msg" | "update";

function HomePage() {
  const navigate = useNavigate();
  const [m3uList, setM3uList] = useState<M3UPlaylist | null>(null);
  const [openConta, setOpenConta] = useState(false);

  // status state
  const [openStatus, setOpenStatus] = useState<StatusKey | null>(null);
  const [recOn, setRecOn] = useState(false);
  const [alarmMin, setAlarmMin] = useState(0);
  const alarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hasCreds = !!store.getCreds();
    const playlists = store.getM3U();
    setM3uList(playlists[0] ?? null);
    if (!hasCreds && playlists.length === 0) navigate({ to: "/" });
  }, [navigate]);

  // Pinta html/body com o mesmo gradiente da Home pra eliminar
  // qualquer "borda branca" do letterbox (TV mode / safe-area do APK).
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    const bg = "#050505";
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
    <div
      className="relative flex h-dvh max-h-dvh flex-col overflow-hidden text-white"
      style={{
        background:
          "radial-gradient(110% 70% at 15% 0%, rgba(220,38,38,0.35) 0%, transparent 55%), radial-gradient(110% 70% at 85% 100%, rgba(37,99,235,0.40) 0%, transparent 55%), linear-gradient(180deg, #0a0a0a 0%, #050505 60%, #000 100%)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Neon glow accents */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-24 size-[60vmin] rounded-full bg-red-600/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-24 size-[60vmin] rounded-full bg-blue-600/25 blur-3xl" />

      {/* Watermark logo */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
      >
        <span className="text-[28vmin] font-black tracking-tighter text-white/[0.05] leading-none">
          SoaresTV
        </span>
      </div>

      {/* Header */}
      <header className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-3 sm:px-6 sm:pt-4">
        <div />
        <div className="flex items-center justify-center gap-2">
          <div className="grid size-9 sm:size-10 place-items-center rounded-xl bg-gradient-to-br from-red-500 to-blue-600 shadow-[0_0_24px_rgba(220,38,38,0.45)]">
            <Tv className="size-5 text-white" strokeWidth={2.2} />
          </div>
          <span className="text-lg sm:text-2xl font-black tracking-[0.18em] bg-gradient-to-r from-red-400 via-white to-blue-400 bg-clip-text text-transparent">
            SOARESTV
          </span>
        </div>
        <div className="flex items-center justify-end gap-1.5 sm:gap-2">
          <StatusIcon icon={RefreshCw}  label="UPDATE" onClick={() => handleStatus("update")} />
          <StatusIcon icon={Lock}       label="VPN"    onClick={() => handleStatus("vpn")} />
          <StatusIcon icon={Mail}       label="MSG"    onClick={() => handleStatus("msg")} />
          <StatusIcon icon={Video}      label="REC"    active={recOn}        activeColor="bg-red-500"     onClick={() => handleStatus("rec")} />
          <StatusIcon icon={AlarmClock} label="ALARM"  active={alarmMin > 0} activeColor="bg-emerald-400" onClick={() => handleStatus("alarm")} />
        </div>
      </header>

      {/* Main 2x2 grid */}
      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 min-h-0 items-center justify-center px-4 py-3 sm:py-6">
        <div className="grid w-full grid-cols-2 gap-3 sm:gap-5 h-full max-h-[560px]">
          {MAIN.map((t, i) => (
            <MainTile key={t.label} tile={t} onClick={() => openTile(t.to, t.label)} defaultFocus={i === 0} />
          ))}
        </div>
      </main>

      {/* Footer bar */}
      <footer className="relative z-10 px-3 pb-3 sm:px-6 sm:pb-4">
        <div className="mx-auto flex max-w-3xl items-stretch justify-between gap-1.5 sm:gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-2 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
          {BOTTOM.map((t) => (
            <FooterItem key={t.label} tile={t} onClick={() => openTile(t.to, t.label)} />
          ))}
        </div>
        <div className="mt-1.5 text-center text-[9px] uppercase tracking-[0.3em] text-white/40">
          Desenvolvido por RedKiLL999
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
      className="group relative flex h-full w-full flex-col items-center justify-center gap-2 sm:gap-3 overflow-hidden rounded-[20px] border border-white/15 bg-white/[0.06] backdrop-blur-xl text-white transition-all duration-200 hover:bg-white/[0.12] hover:border-white/40 hover:scale-[1.02] active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <Icon className="size-10 sm:size-14 transition-transform group-hover:scale-110" strokeWidth={1.5} />
      <span className="text-sm sm:text-lg font-bold tracking-[0.2em]">{tile.label}</span>
    </button>
  );
}

function FooterItem({ tile, onClick }: { tile: Tile; onClick: () => void }) {
  const Icon = tile.icon;
  return (
    <button
      onClick={onClick}
      className="group flex flex-1 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-white/85 transition-all hover:bg-white/10 hover:text-white active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/60"
    >
      <Icon className="size-5 sm:size-6 transition-transform group-hover:scale-110" strokeWidth={1.7} />
      <span className="text-[9px] sm:text-[10px] font-semibold tracking-[0.15em] truncate w-full text-center">{tile.label}</span>
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
