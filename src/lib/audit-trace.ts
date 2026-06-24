// ============================================================================
// [AUDIT TRACE] Instrumentação TEMPORÁRIA de auditoria funcional.
//
// Emite eventos estruturados com timestamp + sessionId para o console e para
// um buffer em memória (últimas 200 entradas) consultável via:
//   window.__auditTrace?.()
//
// Não substitui [LIVE DEBUG] / [LIVE STABILITY] / [PLAYBACK ENGINE] / [LIVE DIAG] —
// só agrega, em UMA prefix uniforme, os pontos exatos que o usuário pediu
// para mapear: troca de canal, engine pick, fallbacks, timeouts, stall,
// underrun, decode fail.
//
// Como desativar (após auditoria): apagar o arquivo + remover os imports.
// Não há lógica de playback aqui — só registro.
// ============================================================================

import { DEBUG } from "@/lib/debug";

export type AuditEventKind =
  | "channel-open"        // novo src recebido pelo VideoPlayer
  | "engine-pick"         // ordem decidida (envia decideEngineOrder result)
  | "engine-try"          // antes de instanciar uma engine
  | "engine-ok"           // hasStartedPlaying virou true
  | "fallback-hls-direct" // attachHls → playDirect (HLS desistiu)
  | "fallback-html5-mpegts" // HTML5 .ts falhou → mpegts.js
  | "fallback-mpegts-html5" // mpegts não-suportado → HTML5 nativo
  | "fallback-503-direct"   // proxy 503 → URL direta injetada
  | "fallback-next-candidate" // tryNextVod incrementa vodIdx
  | "fallback-exo-web"        // ExoPlayer recusou → modo web
  | "timeout-vod"             // armVodWatchdog disparou
  | "timeout-hls-startup"     // hlsStartupTimer estourou
  | "stall"                   // freeze detectado (waiting/stalled/suspend/watchdog)
  | "buffer-underrun"         // bufferedAhead < 1s + recovery
  | "error-decode"            // MediaError.code = 3
  | "error-manifest"          // HLS MANIFEST_PARSING_ERROR / 4xx no manifest
  | "error-network"           // HLS NETWORK_ERROR fatal
  | "final-fail"              // todos os candidatos esgotados
  | "unmount-mid-attempt";    // cleanup com hasStartedPlaying=false

export type AuditEvent = {
  t: number;          // performance.now()
  iso: string;        // timestamp legível
  sessionId: string;  // mesmo id da sessão LiveDiagPanel
  kind: AuditEventKind;
  data: Record<string, unknown>;
};

const BUFFER_MAX = 200;
const buffer: AuditEvent[] = [];

export function auditEvent(
  sessionId: string | null,
  kind: AuditEventKind,
  data: Record<string, unknown> = {},
): void {
  const now = performance.now();
  const ev: AuditEvent = {
    t: Math.round(now),
    iso: new Date().toISOString().slice(11, 23), // HH:MM:SS.mmm
    sessionId: sessionId ?? "(no-session)",
    kind,
    data,
  };
  buffer.push(ev);
  if (buffer.length > BUFFER_MAX) buffer.shift();
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log(`[AUDIT TRACE] ${ev.iso} ${kind}`, { sid: ev.sessionId, ...data });
  }
}

export function auditDump(): AuditEvent[] {
  return buffer.slice();
}

if (typeof window !== "undefined") {
  // Exposição para o console: digite `__auditTrace()` no DevTools.
  (window as unknown as { __auditTrace?: () => AuditEvent[] }).__auditTrace = auditDump;
}
