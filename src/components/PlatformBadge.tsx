// ============================================================================
// PlatformBadge — pílula fixa no canto inferior-esquerdo mostrando qual
// plataforma o app detectou em runtime. Pedido na auditoria de regressão
// Web vs APK para que um build errado seja visível a olho nu.
//
// - Sempre habilitada em DEV (import.meta.env.DEV).
// - Em PROD, só aparece se o usuário ligar via ?platformBadge=1 ou
//   localStorage.setItem("debug:platform-badge", "1").
// - Clique alterna entre minimizado (ponto colorido) e expandido (texto).
// ============================================================================

import { useEffect, useState } from "react";
import { PLATFORM_ANDROID, PLATFORM_ANDROID_TV, PLATFORM_WEB_DESKTOP, platformLabel } from "@/lib/platform-flags";

const COLORS: Record<string, string> = {
  "web-desktop": "#22c55e", // verde — fast-path VOD + HLS.js
  "android": "#3b82f6",     // azul — ExoPlayer + HTTP nativo
  "android-tv": "#a855f7",  // roxo — ExoPlayer + D-Pad
  "ssr": "#71717a",
};

function shouldShow(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search).get("platformBadge");
    if (q === "1") return true;
    if (window.localStorage.getItem("debug:platform-badge") === "1") return true;
  } catch {
    /* noop */
  }
  return false;
}

export function PlatformBadge() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [label, setLabel] = useState<string>("ssr");

  useEffect(() => {
    setVisible(shouldShow());
    setLabel(platformLabel());
  }, []);

  if (!visible) return null;

  const color = COLORS[label] ?? "#71717a";
  const engine = PLATFORM_ANDROID
    ? "ExoPlayer / Native HTTP"
    : PLATFORM_WEB_DESKTOP
      ? "HTML5 + HLS.js / proxy fast-path"
      : "—";

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      title={`Plataforma detectada: ${label}\nEngine: ${engine}\nAndroid=${PLATFORM_ANDROID} TV=${PLATFORM_ANDROID_TV} Web=${PLATFORM_WEB_DESKTOP}`}
      style={{
        position: "fixed",
        left: 8,
        bottom: 8,
        zIndex: 2_147_483_000,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: expanded ? "4px 10px" : 4,
        borderRadius: 999,
        border: `1px solid ${color}`,
        background: "rgba(0,0,0,0.55)",
        color: "#fff",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.2,
        cursor: "pointer",
        backdropFilter: "blur(4px)",
        pointerEvents: "auto",
      }}
      aria-label={`Plataforma ${label}`}
    >
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}`,
        }}
      />
      {expanded && (
        <span style={{ whiteSpace: "nowrap" }}>
          {label.toUpperCase()} · {engine}
        </span>
      )}
    </button>
  );
}
