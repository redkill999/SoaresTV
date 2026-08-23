// =========================================================================
// Playback Janitor — limpeza periódica de buffers de diagnóstico/telemetria
// durante sessões longas no WebView do APK.
//
// GARANTIAS (não negociáveis):
//   - NÃO toca no pipeline de reprodução (hls.js, mpegts.js, proxy, ExoPlayer,
//     watchdogs, host-profile). Apenas apara arrays em memória.
//   - Nenhum patch global (window.fetch / history) — ver memória
//     constraints/no-global-instrumentation.
//   - Um único setInterval, sempre limpo no unmount.
// =========================================================================

const TICK_MS = 60_000;

const CAPS = {
  vodErrors: 30,
  telemetrySessions: 60,
  telemetryEvents: 120,
  proxyCalls: 200,
  metricsSessions: 60,
};

type AnyArr = unknown[] | undefined;

function trim(arr: AnyArr, max: number): void {
  if (Array.isArray(arr) && arr.length > max) arr.splice(0, arr.length - max);
}

/** Uma passada de limpeza. Idempotente e barata (só splice em arrays). */
export function sweepPlaybackBuffers(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    __vodErrors?: unknown[];
    __playbackTelemetry?: { sessions?: Array<{ events?: unknown[] }>; current?: unknown };
    __playbackMetrics?: { sessions?: unknown[]; proxyCalls?: unknown[] };
  };

  try { trim(w.__vodErrors, CAPS.vodErrors); } catch { /* noop */ }

  try {
    const t = w.__playbackTelemetry;
    if (t?.sessions) {
      trim(t.sessions, CAPS.telemetrySessions);
      for (const s of t.sessions) trim(s?.events, CAPS.telemetryEvents);
    }
  } catch { /* noop */ }

  try {
    const m = w.__playbackMetrics;
    if (m) {
      trim(m.sessions, CAPS.metricsSessions);
      trim(m.proxyCalls, CAPS.proxyCalls);
    }
  } catch { /* noop */ }
}

let refCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Liga o janitor enquanto houver ao menos um player montado.
 * Retorna a função de parada (decrementa o refcount).
 */
export function startPlaybackJanitor(): () => void {
  if (typeof window === "undefined") return () => undefined;
  refCount += 1;
  if (!timer) {
    timer = setInterval(sweepPlaybackBuffers, TICK_MS);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && timer) {
      clearInterval(timer);
      timer = null;
      sweepPlaybackBuffers();
    }
  };
}
