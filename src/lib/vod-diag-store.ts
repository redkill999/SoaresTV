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
  redirectLocation?: string;
  directCandidate?: string;
  userAgent?: string;
  originHeaders?: boolean;
  redirected?: boolean;
  failureClass?: string;
  deadMediaBases?: string;
  redirectMode?: string;
  probeError?: string;
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

export function vodDiagUpdateCandidates(id: string, finalCandidates: string[]): void {
  update(id, (s) => { s.finalCandidates = finalCandidates.slice(); });
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
  if (probe.redirectLocation) lines.push(`redirect-location:  ${probe.redirectLocation}`);
  if (probe.directCandidate) lines.push(`direct-candidate:   ${probe.directCandidate}`);
  lines.push(`ua upstream:        ${probe.userAgent || "(vazio)"}`);
  lines.push(`origin/referer:     ${probe.originHeaders ? "sim" : "não"}`);
  lines.push(`redirecionado:      ${probe.redirected ? "sim" : "não"}`);
  if (probe.failureClass) lines.push(`classe falha:       ${probe.failureClass}`);
  if (probe.deadMediaBases) lines.push(`bases CDN mortas:   ${probe.deadMediaBases}`);
  if (probe.redirectMode) lines.push(`modo redirect:      ${probe.redirectMode}`);
  if (probe.probeError) lines.push(`erro probe:         ${probe.probeError}`);
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
      if (a.clientStatus != null || a.upstreamStatus || a.contentType || a.probeError) {
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
  const probes = [s.finalProbe, ...s.attempts].filter(Boolean) as VodHttpProbe[];
  const statusOf = (p?: VodHttpProbe) => Number(p?.upstreamStatus || p?.clientStatus || 0);
  const status = Number(last?.upstreamStatus || s.finalProbe?.upstreamStatus || last?.clientStatus || s.finalProbe?.clientStatus || 0);
  const ct = (last?.contentType || s.finalProbe?.contentType || "").toLowerCase();
  const anyStatus = (code: number) => probes.some((p) => statusOf(p) === code);
  const anyServerStatus = probes.some((p) => statusOf(p) >= 500);
  const anyBadContent = probes.some((p) => /text\/html|application\/json|xml/i.test(p.contentType ?? ""));
  const anyDirectCandidate = probes.some((p) => !!p.directCandidate);
  const redirected404s = probes.filter((p) => statusOf(p) === 404 && p.redirected && (!!p.directCandidate || !!p.finalUrl));
  const redirected404Html = redirected404s.some((p) => /text\/html/i.test(p.contentType ?? ""));
  const diag: string[] = [];
  if (anyStatus(401) || anyStatus(403)) diag.push("  → BLOQUEIO/AUTORIZAÇÃO: host recusou credencial, IP, Referer ou User-Agent.");
  if (anyStatus(404)) diag.push("  → 404: caminho/extensão do VOD pode estar diferente ou CDN retornando falso 404.");
  if (anyStatus(416)) diag.push("  → RANGE rejeitado: servidor não aceitou bytes pedidos pelo navegador.");
  if (anyServerStatus) diag.push("  → ERRO NO SERVIDOR/PROXY: upstream instável ou bloqueando o proxy.");
  if (anyBadContent || /text\/html|application\/json|xml/.test(ct)) diag.push("  → Conteúdo não é vídeo: servidor retornou página/JSON de bloqueio.");
  if (/mpegurl|m3u8/.test(ct) && (last?.contentLength === "0" || s.finalProbe?.contentLength === "0")) {
    diag.push("  → HLS VOD vazio: o painel/CDN retornou manifesto sem segmentos; o player deve pular este candidato.");
  }
  if (redirected404s.length) {
    diag.push("  → Redirecionamento VOD quebrou: a URL Xtream redirecionou para um CDN final que respondeu 404.");
  }
  if (redirected404Html) {
    diag.push("  → CDN final indisponível/bloqueado: o servidor entregou página HTML de erro no lugar do arquivo de vídeo. Não é codec do player.");
  }
  if (redirected404s.length >= 2) {
    diag.push("  → As extensões alternativas também apontaram para o mesmo padrão de CDN com 404; provável VOD offline/removido na origem.");
  }
  if (anyDirectCandidate) {
    diag.push("  → Proxy detectou CDN final; o player também tentou/irá tentar a URL final direta em HTTPS.");
  }
  if (last?.videoErrorCode === 4) diag.push("  → Browser recebeu algo que não conseguiu tratar como mídia compatível.");
  if (last?.videoErrorCode === 3) diag.push("  → Erro de decodificação: codec/container pode não ser suportado no navegador.");
  if (!diag.length) diag.push("  → Sem conclusão automática; copie este log para análise.");
  lines.push(...diag);
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
  const probeBase = url.startsWith("/api/stream")
    ? url
    : /^https?:\/\//i.test(url)
      ? `/api/stream?u=${encodeURIComponent(url)}&kind=vod&v=6`
      : null;
  if (!probeBase) return { probeError: "URL não suportada para probe VOD" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const probeUrl = `${probeBase}${probeBase.includes("?") ? "&" : "?"}probe=1`;
    // Evita "Failed to fetch" vazio em previews onde HEAD em server route é
    // instável; /api/stream?probe=1 responde sem corpo mesmo via GET.
    const res = await fetch(probeUrl, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    return {
      clientStatus: res.status,
      upstreamStatus: res.headers.get("X-Upstream-Status") ?? "",
      contentType: res.headers.get("X-Upstream-Content-Type") ?? res.headers.get("content-type") ?? "",
      contentLength: res.headers.get("content-length") ?? "",
      contentRange: res.headers.get("content-range") ?? "",
      acceptRanges: res.headers.get("accept-ranges") ?? "",
      finalUrl: res.headers.get("X-Upstream-Final-Url") ?? "",
      redirectLocation: res.headers.get("X-Upstream-Redirect-Location") ?? "",
      directCandidate: res.headers.get("X-Upstream-Direct-Candidate") ?? "",
      userAgent: res.headers.get("X-Upstream-User-Agent") ?? "",
      originHeaders: (res.headers.get("X-Upstream-Origin-Headers") ?? "0") === "1",
      redirected: (res.headers.get("X-Upstream-Redirected") ?? "0") === "1",
      failureClass: res.headers.get("X-Upstream-Failure-Class") ?? "",
      deadMediaBases: res.headers.get("X-Upstream-Dead-Media-Bases") ?? "",
      redirectMode: res.headers.get("X-Stream-Redirect-Mode") ?? "",
    };
  } catch (e) {
    return { probeError: e instanceof Error ? e.message : "probe falhou" };
  } finally {
    clearTimeout(t);
  }
}