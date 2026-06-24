// ============================================================================
// [LIVE DIAG STORE] Buffer circular de diagnósticos LIVE (até 50 sessões).
// ----------------------------------------------------------------------------
// Espelha em memória + localStorage o que vai pro console em [LIVE DEBUG],
// para o usuário consultar via UI no APK Android (sem F12). Não interfere
// em playback, cache, login, filmes, séries ou EPG.
// ============================================================================

import type { LiveProbeReport } from "@/lib/live-debug";

export type LivePlayerKind = "html5" | "mpegts" | "hls" | "native" | "unknown";

export type LivePlayerAttempt = {
  player: LivePlayerKind;
  url: string;
  result: "ok" | "fail" | "tried";
  error?: string;
  videoErrorCode?: number | null;
  at: number;
};

export type LiveDiagSession = {
  id: string;
  startedAt: number;
  endedAt?: number;
  originalUrl: string;
  workingSrc: string;
  host: string | null;
  forcedUA: string | null;
  liveBypassProxy: boolean;
  liveDisableHls: boolean;
  livePreferTs: boolean;
  finalCandidates: string[];
  probe?: LiveProbeReport;
  attempts: LivePlayerAttempt[];
  result: "in-progress" | "playing" | "failed";
  failureReason?: string;
};

const MAX_SESSIONS = 50;
const STORAGE_KEY = "live-diag-sessions:v1";

let sessions: LiveDiagSession[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function loadOnce(): void {
  if (loaded) return;
  loaded = true;
  if (!isBrowser()) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LiveDiagSession[];
      if (Array.isArray(parsed)) sessions = parsed.slice(0, MAX_SESSIONS);
    }
  } catch { /* noop */ }
}

function persist(): void {
  if (!isBrowser()) return;
  try {
    // Compacta antes de salvar para não estourar localStorage.
    const slim = sessions.slice(0, MAX_SESSIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch { /* quota: descarta silenciosamente */ }
  for (const fn of listeners) { try { fn(); } catch { /* noop */ } }
}

export function liveDiagSubscribe(fn: () => void): () => void {
  loadOnce();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function liveDiagGetSessions(): LiveDiagSession[] {
  loadOnce();
  return sessions.slice();
}

export function liveDiagClear(): void {
  loadOnce();
  sessions = [];
  persist();
}

export function liveDiagStart(init: Omit<LiveDiagSession, "id" | "startedAt" | "attempts" | "result">): string {
  loadOnce();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const session: LiveDiagSession = {
    ...init,
    id,
    startedAt: Date.now(),
    attempts: [],
    result: "in-progress",
  };
  sessions = [session, ...sessions].slice(0, MAX_SESSIONS);
  persist();
  return id;
}

function update(id: string, mut: (s: LiveDiagSession) => void): void {
  loadOnce();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const next = { ...sessions[idx] };
  mut(next);
  sessions[idx] = next;
  persist();
}

export function liveDiagAttachProbe(id: string, probe: LiveProbeReport): void {
  update(id, (s) => { s.probe = probe; });
}

export function liveDiagRecordAttempt(id: string, attempt: LivePlayerAttempt): void {
  update(id, (s) => { s.attempts = [...s.attempts, attempt]; });
}

export function liveDiagMarkPlaying(id: string, player: LivePlayerKind, url: string): void {
  update(id, (s) => {
    s.attempts = [...s.attempts, { player, url, result: "ok", at: Date.now() }];
    s.result = "playing";
    s.endedAt = Date.now();
  });
}

export function liveDiagMarkFailed(id: string, reason: string): void {
  update(id, (s) => {
    if (s.result === "playing") return; // já tocou; falha posterior é stall, não falha de abertura
    s.result = "failed";
    s.failureReason = reason;
    s.endedAt = Date.now();
  });
}

export function liveDiagLatestFailedFor(originalUrl: string): LiveDiagSession | null {
  loadOnce();
  for (const s of sessions) {
    if (s.originalUrl === originalUrl && s.result === "failed") return s;
  }
  return null;
}

/** Formata uma sessão como texto plano para copiar. */
export function liveDiagFormat(s: LiveDiagSession): string {
  const when = new Date(s.startedAt).toLocaleString();
  const ended = s.endedAt ? new Date(s.endedAt).toLocaleString() : "(em andamento)";
  const lines: string[] = [];
  lines.push("=== DIAGNÓSTICO LIVE — SoaresTV ===");
  lines.push(`Início:    ${when}`);
  lines.push(`Fim:       ${ended}`);
  lines.push(`Resultado: ${s.result.toUpperCase()}${s.failureReason ? ` — ${s.failureReason}` : ""}`);
  lines.push("");
  lines.push("--- URL ---");
  lines.push(`Host detectado: ${s.host ?? "(desconhecido)"}`);
  lines.push(`URL original:   ${s.originalUrl}`);
  lines.push(`URL trabalho:   ${s.workingSrc}`);
  lines.push(`UA forçado:     ${s.forcedUA ?? "(auto — proxy cicla XCIPTV/TiviMate/IPTVSmarters/okhttp/VLC)"}`);
  lines.push("");
  lines.push("--- Preset do host ---");
  lines.push(`bypassProxyForLive:   ${s.liveBypassProxy}`);
  lines.push(`disableHlsConversion: ${s.liveDisableHls}`);
  lines.push(`preferTs:             ${s.livePreferTs}`);
  lines.push("");
  lines.push("--- Probe HTTP HEAD (via /api/stream) ---");
  if (!s.probe) {
    lines.push("(probe não retornou — verifique conexão ou bloqueio de CORS)");
  } else {
    for (const r of s.probe.tried) {
      lines.push(`[UA=${r.ua}] (${r.uaString})`);
      lines.push(`  status:         ${r.status}`);
      lines.push(`  content-type:   ${r.contentType || "(vazio)"}`);
      lines.push(`  accept-ranges:  ${r.acceptRanges || "(vazio)"}`);
      lines.push(`  content-length: ${r.contentLength || "(vazio)"}`);
      lines.push(`  final-url:      ${r.finalUrl}`);
      lines.push(`  redirected:     ${r.redirected}`);
      if (r.error) lines.push(`  erro:           ${r.error}`);
    }
    if (s.probe.best?.ok) {
      lines.push(`MELHOR: UA=${s.probe.best.ua} status=${s.probe.best.status} content-type=${s.probe.best.contentType}`);
    } else {
      lines.push(`MELHOR: nenhum UA respondeu 2xx/3xx — canal offline, host bloqueando ou credencial expirada.`);
    }
  }
  lines.push("");
  lines.push("--- Tentativas de player ---");
  if (!s.attempts.length) {
    lines.push("(nenhuma tentativa registrada)");
  } else {
    s.attempts.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.player.toUpperCase()} → ${a.result.toUpperCase()}`);
      lines.push(`   url:   ${a.url}`);
      if (a.error) lines.push(`   erro:  ${a.error}`);
      if (a.videoErrorCode != null) lines.push(`   code:  ${a.videoErrorCode}`);
    });
  }
  lines.push("");
  lines.push("--- Candidatos (ordem de tentativa) ---");
  s.finalCandidates.forEach((u, i) => lines.push(`${i + 1}. ${u}`));
  lines.push("");
  lines.push(`Sessão: ${s.id}`);
  return lines.join("\n");
}

export function liveDiagFormatAll(): string {
  loadOnce();
  if (!sessions.length) return "(sem sessões registradas)";
  return sessions.map((s) => liveDiagFormat(s)).join("\n\n" + "=".repeat(60) + "\n\n");
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fallback abaixo */ }
  try {
    if (typeof document === "undefined") return false;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
