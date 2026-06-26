/**
 * PremiumChrome — wrapper visual compartilhado pelas telas internas
 * (Live / Movies / Series / Guide / Favorites).
 *
 * Replica o "envelope" da Home: gradiente preto+azul+vermelho, watermark
 * SoaresTV, header com logo central + status icons (Update/VPN/MSG/REC/Alarm)
 * e footer com Catch Up / Multi.
 *
 * REGRA: este componente só cuida do chrome. O conteúdo (sidebar,
 * grids, players, listas) é passado como children e NÃO é tocado.
 */
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft, Tv, RefreshCw, Lock, Mail, Video, AlarmClock,
  RotateCcw, LayoutGrid,
} from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { store } from "@/lib/storage";

type StatusKey = "alarm" | "rec" | "vpn" | "msg" | "update";

export function PremiumChrome({
  title,
  children,
  showBack = true,
  hideFooter = false,
}: {
  title?: string;
  children: ReactNode;
  showBack?: boolean;
  hideFooter?: boolean;
}) {
  const navigate = useNavigate();
  const [openStatus, setOpenStatus] = useState<StatusKey | null>(null);
  const [recOn, setRecOn] = useState(false);
  const [alarmMin, setAlarmMin] = useState(0);
  const alarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pinta html/body pra eliminar bordas brancas (mesma tática da Home)
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevH = html.style.background;
    const prevB = body.style.background;
    html.style.background = "#050505";
    body.style.background = "#050505";
    return () => { html.style.background = prevH; body.style.background = prevB; };
  }, []);

  useEffect(() => {
    const hasCreds = !!store.getCreds();
    const hasM3U = store.getM3U().length > 0;
    if (!hasCreds && !hasM3U) navigate({ to: "/" });
  }, [navigate]);

  useEffect(() => () => {
    if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
  }, []);

  // Fecha modal de status (alarm/vpn/msg) ao apertar ESC / Back / Return
  // (Backspace 8, Esc 27, Tizen Return 10009, WebOS Back 461).
  // Capture phase para rodar antes do tv-dpad global, que senão chamaria history.back().
  useEffect(() => {
    if (!openStatus) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      const c = (e as KeyboardEvent & { keyCode?: number }).keyCode ?? 0;
      const isBack =
        k === "Escape" || k === "Backspace" || k === "GoBack" || k === "BrowserBack" ||
        c === 27 || c === 8 || c === 10009 || c === 461;
      if (!isBack) return;
      e.preventDefault();
      e.stopPropagation();
      setOpenStatus(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openStatus]);

  const runUpdate = () => {
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("m3u-cache:") || k.startsWith("xtream-cache:") || k.startsWith("rq-"))
        .forEach((k) => localStorage.removeItem(k));
      toast.success("Conteúdos atualizados");
      setTimeout(() => navigate({ to: "/loading", replace: true }), 300);
    } catch { toast.error("Falha ao atualizar"); }
  };
  const toggleRec = () => { const n = !recOn; setRecOn(n); toast.success(n ? "Gravação iniciada" : "Gravação parada"); };
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
  const handleStatus = (k: StatusKey) => {
    if (k === "rec") return toggleRec();
    if (k === "update") return runUpdate();
    setOpenStatus(k);
  };

  return (
    <div
      className="relative flex h-dvh max-h-dvh flex-col overflow-hidden text-white"
      style={{
        background:
          "radial-gradient(110% 70% at 15% 0%, rgba(220,38,38,0.32) 0%, transparent 55%), radial-gradient(110% 70% at 85% 100%, rgba(37,99,235,0.38) 0%, transparent 55%), linear-gradient(180deg, #0a0a0a 0%, #050505 60%, #000 100%)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {/* Neon glow */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -left-24 size-[55vmin] rounded-full bg-red-600/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-24 size-[55vmin] rounded-full bg-blue-600/20 blur-3xl" />

      {/* Watermark */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center select-none">
        <span className="text-[24vmin] font-black tracking-tighter text-white/[0.04] leading-none">SoaresTV</span>
      </div>

      {/* Header */}
      <header className="relative z-10 grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 pt-2 sm:px-5 sm:pt-3">
        {showBack ? (
          <button
            onClick={() => navigate({ to: "/home" })}
            aria-label="Voltar"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white/80 hover:bg-white/10"
          >
            <ArrowLeft className="size-3.5" />
            <span className="hidden sm:inline">Home</span>
          </button>
        ) : <span />}

        <div className="flex items-center justify-center gap-2 min-w-0">
          <div className="grid size-7 sm:size-8 place-items-center rounded-lg bg-gradient-to-br from-red-500 to-blue-600 shadow-[0_0_18px_rgba(220,38,38,0.4)] shrink-0">
            <Tv className="size-3.5 sm:size-4 text-white" strokeWidth={2.2} />
          </div>
          <span className="text-sm sm:text-lg font-black tracking-[0.18em] bg-gradient-to-r from-red-400 via-white to-blue-400 bg-clip-text text-transparent truncate">
            SOARESTV
          </span>
          {title && (
            <span className="hidden sm:inline-block ml-2 text-[10px] uppercase tracking-[0.3em] text-white/50 border-l border-white/15 pl-2">
              {title}
            </span>
          )}
        </div>

        <div className="flex items-center justify-end gap-1 sm:gap-1.5">
          <StatusIcon icon={RefreshCw}  label="UPDATE" onClick={() => handleStatus("update")} />
          <StatusIcon icon={Lock}       label="VPN"    onClick={() => handleStatus("vpn")} />
          <StatusIcon icon={Mail}       label="MSG"    onClick={() => handleStatus("msg")} />
          <StatusIcon icon={Video}      label="REC"    active={recOn}        activeColor="bg-red-500"     onClick={() => handleStatus("rec")} />
          <StatusIcon icon={AlarmClock} label="ALARM"  active={alarmMin > 0} activeColor="bg-emerald-400" onClick={() => handleStatus("alarm")} />
        </div>
      </header>

      {/* Conteúdo da tela */}
      <main className="relative z-10 flex-1 min-h-0 overflow-hidden flex flex-col">
        {children}
      </main>

      {/* Footer Catch Up / Multi */}
      {!hideFooter && (
        <footer className="relative z-10 px-3 pb-2 sm:px-5 sm:pb-3">
          <div className="mx-auto flex max-w-md items-stretch justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-1.5 backdrop-blur-xl shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
            <FooterBtn icon={RotateCcw} label="CATCH UP" onClick={() => navigate({ to: "/live" })} />
            <FooterBtn icon={LayoutGrid} label="MULTI" onClick={() => navigate({ to: "/live" })} />
          </div>
        </footer>
      )}

      <Toaster theme="dark" />
      {openStatus === "alarm" && <AlarmInline current={alarmMin} onPick={setSleepTimer} onClose={() => setOpenStatus(null)} />}
      {openStatus === "vpn"   && <SimpleInline title="VPN / Conexão" body={typeof navigator !== "undefined" && navigator.onLine ? "Online" : "Offline"} onClose={() => setOpenStatus(null)} />}
      {openStatus === "msg"   && <SimpleInline title="Mensagens" body="Bem-vindo ao SoaresTV. App pronto para uso." onClose={() => setOpenStatus(null)} />}
    </div>
  );
}

function StatusIcon({
  icon: Icon, label, onClick, active = false, activeColor = "bg-emerald-400",
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  label: string; onClick?: () => void; active?: boolean; activeColor?: string;
}) {
  return (
    <button
      type="button" onClick={onClick} title={label}
      className="relative flex flex-col items-center gap-0.5 text-white/85 hover:text-white transition-colors focus:outline-none px-0.5"
    >
      <Icon className="size-4 sm:size-[18px]" strokeWidth={1.8} />
      <span className="text-[7px] sm:text-[8px] font-semibold tracking-wider">{label}</span>
      {active && (
        <span className={`absolute -top-0.5 -right-0.5 size-1.5 rounded-full ${activeColor} shadow-[0_0_6px_rgba(255,255,255,0.6)]`} />
      )}
    </button>
  );
}

function FooterBtn({
  icon: Icon, label, onClick,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  label: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-1.5 text-white/85 hover:bg-white/10 hover:text-white transition-all active:scale-95 focus:outline-none"
    >
      <Icon className="size-5" strokeWidth={1.7} />
      <span className="text-[10px] font-semibold tracking-[0.18em]">{label}</span>
    </button>
  );
}

function AlarmInline({ current, onPick, onClose }: { current: number; onPick: (m: number) => void; onClose: () => void }) {
  const opts = [0, 15, 30, 60, 90, 120];
  // FIX (a11y): Esc fecha o modal — antes só fechava por clique fora.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b1220] p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sleep-timer-title"
      >
        <h3 id="sleep-timer-title" className="text-sm font-semibold tracking-[0.2em] mb-1">SLEEP TIMER</h3>
        <p className="text-xs text-white/60 mb-4">Desliga o app após o tempo escolhido.</p>
        <div className="grid grid-cols-3 gap-2">
          {opts.map((m) => (
            <button key={m} onClick={() => onPick(m)}
              className={`rounded-lg border py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1FB6FF] ${current === m ? "bg-red-500/20 border-red-400" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
              {m === 0 ? "Off" : `${m} min`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SimpleInline({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0b1220] p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="text-sm font-semibold tracking-[0.2em] mb-2">{title}</h3>
        <p className="text-sm text-white/80">{body}</p>
      </div>
    </div>
  );
}

