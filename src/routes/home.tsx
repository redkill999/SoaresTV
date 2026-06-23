import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { store, type M3UPlaylist, type HistItem } from "@/lib/storage";
import { api, xtreamCredsFromUrl } from "@/lib/xtream";
import { clearPersisted } from "@/lib/query-persist";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import homeBg from "@/assets/home-bg.png.asset.json";

const APP_VERSION = "1.0.0";

export const Route = createFileRoute("/home")({
  component: HomePage,
});

type StatusKey = "alarm" | "rec" | "vpn" | "msg" | "update";

// Hotspots em % (base 1280x720) sobre a imagem
type Hotspot = {
  key: string;
  label: string;
  to?: string;
  action?: StatusKey | "conta";
  // posição em % (left, top, width, height)
  l: number; t: number; w: number; h: number;
};

const HOTSPOTS: Hotspot[] = [
  // Ícones de status (topo direito)
  { key: "alarm",  label: "ALARME",     action: "alarm",  l: 66.5, t: 4,  w: 7, h: 16 },
  { key: "rec",    label: "GRAVAR",     action: "rec",    l: 73.5, t: 4,  w: 7, h: 16 },
  { key: "vpn",    label: "VPN",        action: "vpn",    l: 80.5, t: 4,  w: 7, h: 16 },
  { key: "msg",    label: "MENSAGENS",  action: "msg",    l: 87.5, t: 4,  w: 7, h: 16 },
  { key: "update", label: "ATUALIZAR",  action: "update", l: 94.0, t: 4,  w: 6, h: 16 },

  // Tiles principais
  { key: "live",   label: "TV AO VIVO", to: "/live",     l: 6.5,  t: 30, w: 19, h: 44 },
  { key: "epg",    label: "GUIA",       to: "/guide",    l: 28.5, t: 30, w: 19, h: 44 },
  { key: "vod",    label: "FILMES",     to: "/movies",   l: 50.5, t: 30, w: 19, h: 44 },
  { key: "series", label: "SÉRIES",     to: "/series",   l: 72.5, t: 30, w: 19, h: 44 },

  // Rodapé esquerdo
  { key: "account",  label: "CONTA",       action: "conta", l: 3.5,  t: 76, w: 10, h: 20 },
  { key: "multi",    label: "MULTITELA",   to: "/live",     l: 14.5, t: 76, w: 10, h: 20 },
  { key: "catchup",  label: "REPRISE",     to: "/live",     l: 25.5, t: 76, w: 10, h: 20 },

  // Rodapé direito
  { key: "favorite", label: "FAVORITOS",   to: "/favorites", l: 67.5, t: 76, w: 10, h: 20 },
  { key: "radio",    label: "RÁDIO",       to: "/live",      l: 78.5, t: 76, w: 10, h: 20 },
  { key: "settings", label: "CONFIGURAÇÕES", to: "/settings", l: 89.5, t: 76, w: 10, h: 20 },
];

function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [m3uList, setM3uList] = useState<M3UPlaylist | null>(null);
  const [openConta, setOpenConta] = useState(false);

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

  // Fundo preto em html/body — sem bordas brancas no TV/safe-area
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    html.style.background = "#000";
    body.style.background = "#000";
    return () => { html.style.background = prevHtml; body.style.background = prevBody; };
  }, []);

  useEffect(() => () => {
    if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
  }, []);

  const goTo = (to: string) => {
    const usesPlaylistContent = to === "/live" || to === "/movies" || to === "/series";
    if (m3uList && !store.getCreds() && usesPlaylistContent) {
      const xtreamCreds = xtreamCredsFromUrl(m3uList.url, m3uList.username, m3uList.password);
      if (xtreamCreds) { store.setCreds(xtreamCreds); navigate({ to }); return; }
      navigate({ to: "/playlist", search: { url: m3uList.url, name: m3uList.name } });
      return;
    }
    navigate({ to });
  };

  const setSleepTimer = (mins: number) => {
    if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
    setAlarmMin(mins);
    if (mins <= 0) { toast.success("Alarme desligado"); setOpenStatus(null); return; }
    alarmTimerRef.current = setTimeout(() => {
      toast("Sleep timer", { description: "Tempo encerrado, voltando ao login." });
      store.setCreds(null);
      navigate({ to: "/", replace: true });
    }, mins * 60_000);
    toast.success(`Alarme: ${mins} min`);
    setOpenStatus(null);
  };

  const toggleRec = () => { const next = !recOn; setRecOn(next); toast.success(next ? "Gravação iniciada" : "Gravação parada"); };

  const runUpdate = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("m3u-cache:") || k.startsWith("xtream-cache:") || k.startsWith("rq-"))
        .forEach((k) => localStorage.removeItem(k));
      clearPersisted();
      queryClient.clear();
      toast.success("Conteúdos atualizados");
      setTimeout(() => navigate({ to: "/loading", replace: true }), 300);
    } catch { toast.error("Falha ao atualizar"); }
  };

  const onHotspot = (h: Hotspot) => {
    if (h.action === "rec")    return toggleRec();
    if (h.action === "update") return runUpdate();
    if (h.action === "conta")  return setOpenConta(true);
    if (h.action)              return setOpenStatus(h.action);
    if (h.to)                  return goTo(h.to);
  };

  return (
    <div
      className="home-wrapper relative flex h-dvh max-h-dvh w-full items-center justify-center overflow-hidden bg-black text-white"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Fundo borrado: a mesma arte esticada e desfocada preenche os
          espaços laterais/superiores quando a viewport não é exatamente
          16:9. Sem barras pretas, sem zoom destrutivo, sem distorção
          aparente (o blur disfarça qualquer stretch). */}
      <img
        src={homeBg.url}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover scale-110 blur-2xl opacity-70 pointer-events-none"
      />

      {/* Canvas 16:9 nítido — fica contido na viewport sem cortar nenhum
          hotspot. Em TV mode o CSS .home-canvas override força 100%x100%. */}
      <div
        className="relative home-canvas"
        style={{
          aspectRatio: "16 / 9",
          width: "min(100%, calc(100dvh * 16 / 9))",
          height: "min(100dvh, calc(100% * 9 / 16))",
        }}
      >
        <img
          src={homeBg.url}
          alt="SoaresTV"
          draggable={false}
          className="home-bg pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
        />




        {HOTSPOTS.map((h) => (
          <button
            key={h.key}
            type="button"
            onClick={() => onHotspot(h)}
            data-tv-default-focus={h.key === "live" ? "" : undefined}
            title={h.label}
            aria-label={h.label}
            className="group absolute rounded-2xl outline-none transition-all duration-150 hover:bg-white/[0.07] focus-visible:bg-white/[0.10] focus-visible:ring-2 focus-visible:ring-white/80 active:scale-[0.97]"
            style={{
              left: `${h.l}%`,
              top: `${h.t}%`,
              width: `${h.w}%`,
              height: `${h.h}%`,
            }}
          >
            {/* indicador visual ao focar (TV / teclado) */}
            <span className="sr-only">{h.label}</span>
            {h.key === "rec" && recOn && (
              <span className="absolute right-2 top-2 size-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
            )}
            {h.key === "alarm" && alarmMin > 0 && (
              <span className="absolute right-2 top-2 size-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            )}
          </button>
        ))}
      </div>

      <Toaster theme="dark" />

      <AlarmDialog open={openStatus === "alarm"} onClose={() => setOpenStatus(null)} current={alarmMin} onPick={setSleepTimer} />
      <VpnDialog open={openStatus === "vpn"} onClose={() => setOpenStatus(null)} />
      <MsgDialog open={openStatus === "msg"} onClose={() => setOpenStatus(null)} />
      <ContaDialog open={openConta} onClose={() => setOpenConta(false)} />
    </div>
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
            <div className="text-xs text-muted-foreground">App pronto para uso. Versão {APP_VERSION}</div>
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
  } catch { return String(v); }
}

function resolveXtreamCreds() {
  try {
    const direct = store.getCreds();
    if (direct?.server && direct.username && direct.password) return direct;
  } catch { /* ignore */ }
  try {
    const lists = store.getM3U();
    for (const l of lists) {
      const c = xtreamCredsFromUrl(l.url, l.username, l.password);
      if (c) return c;
    }
  } catch { /* ignore */ }
  return null;
}

function ContaDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [info, setInfo] = useState<XtUserInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasCreds, setHasCreds] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const creds = resolveXtreamCreds();
    setHasCreds(!!creds);
    setInfo(null);
    setError(null);
    if (!creds) { setLoading(false); return; }
    // Persist for next time so other screens also have it.
    try { store.setCreds(creds); } catch { /* ignore */ }
    setLoading(true);
    (async () => {
      try {
        const r = await api<{ user_info?: XtUserInfo }>(creds);
        if (!alive) return;
        if (r?.user_info) setInfo(r.user_info);
        else setError("O servidor não retornou informações da conta.");
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Falha ao consultar o servidor.");
      } finally { if (alive) setLoading(false); }
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
          <DialogDescription className="text-white/60">Informações da sua assinatura.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6 pb-6 pt-2 text-sm">
          {!hasCreds && <p className="text-white/70">Nenhuma lista Xtream encontrada. Faça login com DNS/usuário/senha para ver os detalhes da conta.</p>}
          {hasCreds && loading && <p className="text-white/70">Carregando…</p>}
          {hasCreds && !loading && info && (
            <>
              <Row label="Usuário" value={info.username ?? "—"} />
              <Row label="Status" value={<span className={isActive ? "text-emerald-400" : "text-red-400"}>{statusRaw || "—"}</span>} />
              <Row label="Trial" value={isTrial ?? "—"} />
              <Row label="Conexões" value={`${info.active_cons ?? "0"} / ${info.max_connections ?? "?"}`} />
              <Row label="Expira" value={formatExp(info.exp_date)} />
              {info.message && <p className="text-xs text-white/60">{info.message}</p>}
            </>
          )}
          {hasCreds && !loading && !info && (
            <p className="text-white/70">{error ?? "Não foi possível obter informações."}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-2">
      <span className="text-white/60">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
