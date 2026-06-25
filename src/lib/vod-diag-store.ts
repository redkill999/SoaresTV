// ============================================================================
// [VOD DIAG STORE] Buffer circular de diagnósticos VOD (filmes/séries).
// ----------------------------------------------------------------------------
// Diagnóstico temporário para preview web/APK: registra as últimas 50 sessões
// VOD, candidatos tentados, player usado, erros do <video>/hls/mpegts e headers
// expostos pelo /api/stream. Não altera a lógica de reprodução.
// ============================================================================

export type VodPlayerKind = "html5" | "mpegts" | "hls" | "native" | "unknown";

export type VodHttpProbe = {
  clientStatus?: number | string;
  upstreamStatus?: string;
  contentType?: string;
  contentLength?: string;
  contentRange?: string;
  acceptRanges?: string;
  finalUrl?: string;
  userAgent?: string;
  originHeaders?: boolean;
  redirected?: boolean;
  error?: string;
};

export type VodPlayerAttempt = VodHttpProbe & {
  id: string;
  player: VodPlayerKind;
  url: string;
  result: "ok" | "fail" | "tried";
  error?: string;
  videoErrorCode?: number | null;
  readyState?: number;
  networkState?: number;
  currentTime?: number;
  duration?: number;
  at: number;
};

export type VodDiagSession = {
  id: string;
  startedAt: number;
  endedAt?: number;
  sourceKind: "movie" | "series" | "vod";
  originalUrl: string;
  workingSrc: string;
  host: string | null;
  forcedUA: string | null;
  finalCandidates: string[];
  attempts: VodPlayerAttempt[];
  result: "in-progress" | "playing" | "failed";
  failureReason?: string;
  finalProbe?: VodHttpProbe;
};

function fixed(n: number | undefined, digits = 2): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "?";
}

const MAX_SESSIONS = 50;
const STORAGE_KEY = "vod-diag-sessions:v1";

let sessions: VodDiagSession[] = [];
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
      const parsed = JSON.parse(raw) as VodDiagSession[];
      if (Array.isArray(parsed)) sessions = parsed.slice(0, MAX_SESSIONS);
    }
  } catch { /* noop */ }
}

function persist(): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch { /* quota: descarta silenciosamente */ }
  for (const fn of listeners) { try { fn(); } catch { /* noop */ } }
}

function update(id: string, mut: (s: VodDiagSession) => void): void {
  loadOnce();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const next = { ...sessions[idx], attempts: sessions[idx].attempts.slice() };
  mut(next);
  sessions[idx] = next;
  persist();
}

export function vodDiagSubscribe(fn: () => void): () => void {
  loadOnce();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function vodDiagGetSessions(): VodDiagSession[] {
  loadOnce();
  return sessions.slice();
}

export function vodDiagClear(): void {
  loadOnce();
  sessions = [];
  persist();
}

export function vodDiagStart(init: Omit<VodDiagSession, "id" | "startedAt" | "attempts" | "result">): string {
  loadOnce();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const session: VodDiagSession = {
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

export function vodDiagRecordAttempt(id: string, attempt: Omit<VodPlayerAttempt, "id"> & { id?: string }): string {
  const attemptId = attempt.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  update(id, (s) => {
    s.attempts = [...s.attempts, { ...attempt, id: attemptId }].slice(-80);
  });
  return attemptId;
}

export function vodDiagPatchAttempt(sessionId: string, attemptId: string, patch: VodHttpProbe): void {
  update(sessionId, (s) => {
    s.attempts = s.attempts.map((a) => (a.id === attemptId ? { ...a, ...patch } : a));
  });
}

export function vodDiagAttachFinalProbe(id: string, probe: VodHttpProbe): void {
  update(id, (s) => { s.finalProbe = probe; });
}

export function vodDiagMarkPlaying(id: string, player: VodPlayerKind, url: string): void {
  update(id, (s) => {
    s.attempts = [...s.attempts, { id: `${Date.now().toString(36)}-ok`, player, url, result: "ok", at: Date.now() }];
    s.result = "playing";
    s.endedAt = Date.now();
  });
}

export function vodDiagMarkFailed(id: string, reason: string): void {
  update(id, (s) => {
    if (s.result === "playing") return;
    s.result = "failed";
    s.failureReason = reason;
    s.endedAt = Date.now();
  });
}

export function vodDiagLatestFailedFor(originalUrl: string): VodDiagSession | null {
  loadOnce();
  for (const s of sessions) {
    if (s.originalUrl === originalUrl && s.result === "failed") return s;
  }
  return null;
}

function fmtProbe(lines: string[], probe?: VodHttpProbe): void {
  if (!probe) {
    lines.push("(sem probe HTTP capturado)");
    return;
  }
  lines.push(`status cliente:     ${probe.clientStatus ?? "(vazio)"}`);
  lines.push(`status upstream:    ${probe.upstreamStatus || "(vazio)"}`);
  lines.push(`content-type:       ${probe.contentType || "(vazio)"}`);
  lines.push(`content-length:     ${probe.contentLength || "(vazio)"}`);
  lines.push(`content-range:      ${probe.contentRange || "(vazio)"}`);
  lines.push(`accept-ranges:      ${probe.acceptRanges || "(vazio)"}`);
  lines.push(`final-url:          ${probe.finalUrl || "(vazio)"}`);
  lines.push(`ua upstream:        ${probe.userAgent || "(vazio)"}`);
  lines.push(`origin/referer:     ${probe.originHeaders ? "sim" : "não"}`);
  lines.push(`redirecionado:      ${probe.redirected ? "sim" : "não"}`);
  if (probe.error) lines.push(`erro probe:         ${probe.error}`);
}

export function vodDiagFormat(s: VodDiagSession): string {
  const when = new Date(s.startedAt).toLocaleString();
  const ended = s.endedAt ? new Date(s.endedAt).toLocaleString() : "(em andamento)";
  const lines: string[] = [];
  lines.push("=== DIAGNÓSTICO VOD — SoaresTV ===");
  lines.push(`Tipo:      ${s.sourceKind.toUpperCase()}`);
  lines.push(`Início:    ${when}`);
  lines.push(`Fim:       ${ended}`);
  lines.push(`Resultado: ${s.result.toUpperCase()}${s.failureReason ? ` — ${s.failureReason}` : ""}`);
  lines.push("");
  lines.push("--- URL ---");
  lines.push(`Host detectado: ${s.host ?? "(desconhecido)"}`);
  lines.push(`URL original:   ${s.originalUrl}`);
  lines.push(`URL trabalho:   ${s.workingSrc}`);
  lines.push(`UA forçado:     ${s.forcedUA ?? "(auto — proxy cicla UAs)"}`);
  lines.push("");
  lines.push("--- Candidatos VOD (ordem de tentativa) ---");
  s.finalCandidates.forEach((u, i) => lines.push(`${i + 1}. ${u}`));
  lines.push("");
  lines.push("--- Tentativas de player ---");
  if (!s.attempts.length) {
    lines.push("(nenhuma tentativa registrada)");
  } else {
    s.attempts.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.player.toUpperCase()} → ${a.result.toUpperCase()}`);
      lines.push(`   url:   ${a.url}`);
      if (a.error) lines.push(`   erro:  ${a.error}`);
      if (a.videoErrorCode != null) lines.push(`   video error code: ${a.videoErrorCode}`);
      lines.push(`   ready/network: ${a.readyState ?? "?"}/${a.networkState ?? "?"} t=${fixed(a.currentTime)} dur=${fixed(a.duration)}`);
      if (a.clientStatus != null || a.upstreamStatus || a.contentType || a.error) {
        lines.push("   HTTP:");
        const sub: string[] = [];
        fmtProbe(sub, a);
        sub.forEach((line) => lines.push(`     ${line}`));
      }
    });
  }
  lines.push("");
  lines.push("--- Probe final /api/stream ---");
  fmtProbe(lines, s.finalProbe);
  lines.push("");
  lines.push("DIAGNÓSTICO AUTOMÁTICO:");
  const last = s.attempts[s.attempts.length - 1];
  const status = Number(last?.upstreamStatus || s.finalProbe?.upstreamStatus || last?.clientStatus || s.finalProbe?.clientStatus || 0);
  const ct = (last?.contentType || s.finalProbe?.contentType || "").toLowerCase();
  if (status === 401 || status === 403) lines.push("  → BLOQUEIO/AUTORIZAÇÃO: host recusou credencial, IP, Referer ou User-Agent.");
  if (status === 404) lines.push("  → 404: caminho/extensão do VOD pode estar diferente ou CDN retornando falso 404.");
  if (status === 416) lines.push("  → RANGE rejeitado: servidor não aceitou bytes pedidos pelo navegador.");
  if (status >= 500) lines.push("  → ERRO NO SERVIDOR/PROXY: upstream instável ou bloqueando o proxy.");
  if (/text\/html|application\/json|xml/.test(ct)) lines.push("  → Conteúdo não é vídeo: servidor retornou página/JSON de bloqueio.");
  if (last?.videoErrorCode === 4) lines.push("  → Browser recebeu algo que não conseguiu tratar como mídia compatível.");
  if (last?.videoErrorCode === 3) lines.push("  → Erro de decodificação: codec/container pode não ser suportado no navegador.");
  if (!lines[lines.length - 1].startsWith("  →")) lines.push("  → Sem conclusão automática; copie este log para análise.");
  lines.push("");
  lines.push(`Sessão: ${s.id}`);
  return lines.join("\n");
}

export function vodDiagFormatAll(): string {
  loadOnce();
  if (!sessions.length) return "(sem sessões VOD registradas)";
  return sessions.map((s) => vodDiagFormat(s)).join("\n\n" + "=".repeat(60) + "\n\n");
}

export async function probeVodCandidateForDiag(url: string): Promise<VodHttpProbe> {
  if (!url.startsWith("/api/stream")) return { error: "URL direta: probe HTTP omitido para evitar CORS" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6_000);
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store", signal: ctrl.signal });
    return {
      clientStatus: res.status,
      upstreamStatus: res.headers.get("X-Upstream-Status") ?? "",
      contentType: res.headers.get("X-Upstream-Content-Type") ?? res.headers.get("content-type") ?? "",
      contentLength: res.headers.get("content-length") ?? "",
      contentRange: res.headers.get("content-range") ?? "",
      acceptRanges: res.headers.get("accept-ranges") ?? "",
      finalUrl: res.headers.get("X-Upstream-Final-Url") ?? "",
      userAgent: res.headers.get("X-Upstream-User-Agent") ?? "",
      originHeaders: (res.headers.get("X-Upstream-Origin-Headers") ?? "0") === "1",
      redirected: (res.headers.get("X-Upstream-Redirected") ?? "0") === "1",
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "probe falhou" };
  } finally {
    clearTimeout(t);
  }
}