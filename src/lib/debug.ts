// ============================================================================
// Debug flag central. Default: ligado em DEV, desligado em PROD.
// Pode ser sobrescrito em runtime gravando `soarestv:debug` no localStorage:
//   localStorage.setItem("soarestv:debug", "1") → liga
//   localStorage.setItem("soarestv:debug", "0") → desliga
// Importante: NÃO afeta o LiveDiagPanel nem live-diag-store (persistência em
// app continua intacta). Só silencia console.log de telemetria muito frequente
// (ex: tick de 5s do LIVE STABILITY) em build de produção.
// ============================================================================

const isBrowser = typeof window !== "undefined";

function readOverride(): boolean | null {
  if (!isBrowser) return null;
  try {
    const v = localStorage.getItem("soarestv:debug");
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch { /* noop */ }
  return null;
}

const override = readOverride();
export const DEBUG: boolean =
  override !== null ? override : Boolean(import.meta.env?.DEV);

export function dlog(...args: unknown[]): void {
  if (!DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(...args);
}
