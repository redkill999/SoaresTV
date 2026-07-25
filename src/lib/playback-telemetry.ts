// =========================================================================
// Playback Telemetry — sessão por reprodução (playbackId único) que amarra
// eventos vindos do playback-metrics (nav/clique/media) COM marks passivos
// emitidos pelo VideoPlayer (create/attach/manifest/native).
//
// GARANTIAS:
//   - Apenas push/mark sincronizado em memória.
//   - Nenhuma leitura/escrita de storage.
//   - Nenhuma alteração de comportamento do player.
// =========================================================================

export type PipelineKind = "hls.js" | "mpegts.js" | "native-exo" | "html5";

export type PlaybackEvent =
  | "click"
  | "router"
  | "player-create-start"
  | "player-create-end"
  | "attach-media-start"
  | "attach-media-end"
  | "manifest-parsed"
  | "video-src-set"
  | "native-open-start"
  | "native-open-end"
  | "loadedmetadata"
  | "canplay"
  | "playing"
  | "first-frame";

export interface PlaybackSession {
  id: string;
  path: string;
  kind: "live" | "vod" | null;
  host?: string;
  pipeline?: PipelineKind;
  viaProxy?: boolean;
  url?: string; // mascarada
  createdAt: number; // performance.now() da criação (≈ nav)
  events: Array<{ name: PlaybackEvent; t: number }>;
}

interface TelemetryState {
  current?: PlaybackSession;
  sessions: PlaybackSession[];
}

declare global {
  interface Window {
    __playbackTelemetry?: TelemetryState;
  }
}

function maskUrl(u: string | undefined): string | undefined {
  if (!u) return u;
  return u.replace(/([?&](username|password|token|u)=)[^&]+/gi, "$1***");
}

function hostOf(u: string | undefined): string | undefined {
  if (!u) return undefined;
  try {
    if (/^\/api\/stream\?/i.test(u)) {
      const inner = new URL(u, "http://x").searchParams.get("u");
      if (inner) return new URL(inner).host;
    }
    return new URL(u, "http://x").host;
  } catch {
    return undefined;
  }
}

function getState(): TelemetryState {
  if (typeof window === "undefined") {
    return { sessions: [] };
  }
  if (!window.__playbackTelemetry) {
    window.__playbackTelemetry = { sessions: [] };
  }
  return window.__playbackTelemetry;
}

function newId(): string {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8)
  );
}

/** Inicia uma nova sessão (chamado pelo playback-metrics no nav). */
export function beginPlaybackSession(input: {
  path: string;
  kind: "live" | "vod" | null;
  clickT?: number;
  navT?: number;
}): PlaybackSession {
  const st = getState();
  const now = performance.now();
  const session: PlaybackSession = {
    id: newId(),
    path: input.path,
    kind: input.kind,
    createdAt: input.navT ?? now,
    events: [],
  };
  if (input.clickT != null) session.events.push({ name: "click", t: input.clickT });
  session.events.push({ name: "router", t: input.navT ?? now });
  st.current = session;
  st.sessions.push(session);
  // Cap para não crescer indefinidamente na sessão de debug.
  if (st.sessions.length > 200) st.sessions.splice(0, st.sessions.length - 200);
  return session;
}

/**
 * Marca um evento na sessão corrente. Metadata (pipeline/url/viaProxy) é
 * gravada apenas na primeira vez que aparece — updates posteriores não
 * sobrescrevem. Este é o ÚNICO trabalho feito: push em array + set de
 * campo opcional. Sem I/O, sem storage, sem timers.
 */
export function markPlayback(
  name: PlaybackEvent,
  meta?: { pipeline?: PipelineKind; url?: string; viaProxy?: boolean },
): void {
  if (typeof window === "undefined") return;
  const st = getState();
  const s = st.current;
  if (!s) return;
  s.events.push({ name, t: performance.now() });
  if (meta) {
    if (meta.pipeline && !s.pipeline) s.pipeline = meta.pipeline;
    if (meta.url && !s.url) {
      s.url = maskUrl(meta.url);
      s.host = hostOf(meta.url);
    }
    if (meta.viaProxy != null && s.viaProxy == null) s.viaProxy = meta.viaProxy;
  }
}

export function getPlaybackSessions(): PlaybackSession[] {
  return getState().sessions;
}

export function resetPlaybackSessions(): void {
  const st = getState();
  st.sessions.length = 0;
  st.current = undefined;
}
