import { Tv } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Splash de abertura estilo XCIPTV — somente APK Android (celular/TV).
 * Anima ~3s e chama onDone(). Sem usar vídeo: 100% CSS pra carregar instantâneo.
 */
export function NativeSplash({ onDone, duration = 2800 }: { onDone: () => void; duration?: number }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), duration - 350);
    const t2 = setTimeout(onDone, duration);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [duration, onDone]);

  return (
    <div
      className={`fixed inset-0 z-[9999] overflow-hidden transition-opacity duration-300 ${leaving ? "opacity-0" : "opacity-100"}`}
      style={{
        background:
          "radial-gradient(ellipse at center, #0a2a6b 0%, #061635 55%, #02081f 100%)",
      }}
      aria-hidden
    >
      {/* Estrelas / partículas */}
      <div className="ns-stars" />
      <div className="ns-stars ns-stars-2" />

      {/* Ondas concêntricas */}
      <div className="absolute inset-0 grid place-items-center">
        <div className="ns-ring" style={{ animationDelay: "0s" }} />
        <div className="ns-ring" style={{ animationDelay: "0.6s" }} />
        <div className="ns-ring" style={{ animationDelay: "1.2s" }} />
      </div>

      {/* Logo + marca */}
      <div className="relative h-full w-full grid place-items-center">
        <div className="flex flex-col items-center gap-6">
          <div className="ns-logo grid place-items-center">
            <div className="ns-logo-glow" />
            <div className="relative size-28 sm:size-32 rounded-[28%] bg-gradient-to-br from-cyan-400 via-sky-500 to-indigo-600 grid place-items-center shadow-[0_0_60px_rgba(56,189,248,0.6)]">
              <Tv className="size-14 sm:size-16 text-white drop-shadow" strokeWidth={2.25} />
            </div>
          </div>

          <div className="overflow-hidden">
            <h1 className="ns-title text-3xl sm:text-4xl font-black tracking-[0.35em] text-white">
              SOARESTV
            </h1>
          </div>

          <div className="ns-tagline text-[11px] sm:text-xs tracking-[0.4em] text-cyan-200/70">
            YOUR IPTV · EVERY SCREEN
          </div>

          <div className="ns-bar mt-4 h-[3px] w-44 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-400 ns-bar-fill" />
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ns-pop {
          0%   { transform: scale(0.4) rotate(-8deg); opacity: 0; }
          60%  { transform: scale(1.08) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes ns-glow {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 0.95; transform: scale(1.15); }
        }
        @keyframes ns-ring-pulse {
          0%   { transform: scale(0.2); opacity: 0.9; border-color: rgba(125,211,252,0.9); }
          100% { transform: scale(2.4); opacity: 0;   border-color: rgba(125,211,252,0); }
        }
        @keyframes ns-title-rise {
          0%   { transform: translateY(110%); opacity: 0; letter-spacing: 0.6em; }
          100% { transform: translateY(0);    opacity: 1; letter-spacing: 0.35em; }
        }
        @keyframes ns-tagline-fade {
          0%, 40% { opacity: 0; transform: translateY(6px); }
          100%    { opacity: 1; transform: translateY(0); }
        }
        @keyframes ns-bar-fill {
          0%   { transform: translateX(-120%); }
          100% { transform: translateX(360%); }
        }
        @keyframes ns-stars-drift {
          from { transform: translateY(0); }
          to   { transform: translateY(-120px); }
        }

        .ns-logo { animation: ns-pop 900ms cubic-bezier(.2,.9,.25,1.2) both; }
        .ns-logo-glow {
          position: absolute;
          inset: -20%;
          border-radius: 999px;
          background: radial-gradient(circle, rgba(56,189,248,0.55), transparent 65%);
          filter: blur(20px);
          animation: ns-glow 2.2s ease-in-out infinite;
        }
        .ns-ring {
          position: absolute;
          width: 220px; height: 220px;
          border-radius: 999px;
          border: 2px solid rgba(125,211,252,0.7);
          animation: ns-ring-pulse 2.4s ease-out infinite;
        }
        .ns-title {
          display: inline-block;
          animation: ns-title-rise 700ms cubic-bezier(.2,.85,.25,1) 350ms both;
          background: linear-gradient(90deg,#e0f2fe,#7dd3fc 50%,#a5b4fc);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .ns-tagline { animation: ns-tagline-fade 900ms ease-out 900ms both; }
        .ns-bar-fill { animation: ns-bar-fill 1.6s cubic-bezier(.4,0,.2,1) 600ms infinite; }

        .ns-stars {
          position: absolute; inset: -20% 0;
          background-image:
            radial-gradient(2px 2px at 10% 20%, rgba(255,255,255,0.7), transparent 50%),
            radial-gradient(1.5px 1.5px at 30% 60%, rgba(186,230,253,0.6), transparent 50%),
            radial-gradient(1px 1px at 50% 40%, rgba(255,255,255,0.5), transparent 50%),
            radial-gradient(1.5px 1.5px at 75% 80%, rgba(186,230,253,0.7), transparent 50%),
            radial-gradient(1px 1px at 85% 25%, rgba(255,255,255,0.6), transparent 50%),
            radial-gradient(2px 2px at 65% 55%, rgba(255,255,255,0.5), transparent 50%),
            radial-gradient(1px 1px at 20% 85%, rgba(186,230,253,0.5), transparent 50%);
          background-size: 100% 100%;
          opacity: 0.7;
          animation: ns-stars-drift 8s linear infinite;
        }
        .ns-stars-2 {
          opacity: 0.4;
          animation-duration: 14s;
          animation-direction: reverse;
          filter: blur(1px);
        }
      `}</style>
    </div>
  );
}
