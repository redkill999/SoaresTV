// =========================================================================
// Playback Metrics — instrumentação TEMPORÁRIA (read-only) para medir onde
// o tempo é gasto na cadeia de reprodução LIVE. NÃO altera nenhum
// comportamento do player ou proxy. Só coleta e loga.
//
// Coleta:
//   - toda chamada a /api/stream: URL, kind, ua forçado, duração fetch,
//     status devolvido, e (se o proxy expor) tempos por UA via header
//     X-Proxy-UA-Timings.
//   - eventos `playing`/`loadeddata` de qualquer <video> em capture phase
//     (media events não bubblam, mas capture recebe em ancestrais).
//   - click em elementos com [data-live-channel] (opcional; se não houver o
//     atributo, usa a última navegação para /player/live/*).
//
// Uso: `installPlaybackMetrics()` chamado uma vez do __root em client-only.
// Reporte: `window.__playbackReport()` no console → tabela resumida.
// =========================================================================

type ProxyCall = {
  t0: number;
  t1: number;
  ms: number;
  url: string;         // full /api/stream?u=... (mascarada)
  upstreamHost: string;
  kind: string | null;
  forcedUa: string | null;
  status: number;
  uaTimings?: string;  // header cru vindo do servidor, se disponível
  uaWinner?: string;
  uaAttempts?: number;
};

type FirstFrame = {
  t: number;
  src: string;
};

type Navigation = {
  t: number;
  path: string;
  kind: "live" | "vod";
};

type Metrics = {
  proxyCalls: ProxyCall[];
  firstFrames: FirstFrame[];
  navigations: Navigation[];
  install(): void;
  report(): void;
  reset(): void;
};

declare global {
  interface Window {
    __playbackMetrics?: Metrics;
    __playbackReport?: () => void;
    __playbackReset?: () => void;
  }
}

function maskUrl(u: string): string {
  return u.replace(/([?&](username|password|token|u)=)[^&]+/gi, "$1***");
}

function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`;
}

function summarize(state: Metrics): void {
  const calls = state.proxyCalls;
  const frames = state.firstFrames;
  const navs = state.navigations;

  const byStatus: Record<string, number> = {};
  let sumMs = 0;
  let timeouts = 0;
  for (const c of calls) {
    const key = String(c.status || "err");
    byStatus[key] = (byStatus[key] || 0) + 1;
    sumMs += c.ms;
    if (c.status === 0 && c.ms >= 19_500) timeouts++;
  }

  const attempts = calls.map((c) => c.uaAttempts ?? 1).filter((n) => n > 0);
  const avgAttempts =
    attempts.length ? attempts.reduce((a, b) => a + b, 0) / attempts.length : 0;

  // Match navigate → first frame por proximidade temporal.
  const perChannel: Array<{ navAt: number; framedAt?: number; deltaMs?: number; path: string; kind: "live" | "vod"; src?: string }> = [];
  for (const n of navs) {
    const f = frames.find((f) => f.t > n.t && f.t - n.t < 60_000);
    perChannel.push({
      navAt: n.t,
      framedAt: f?.t,
      deltaMs: f ? f.t - n.t : undefined,
      path: n.path,
      kind: n.kind,
      src: f?.src ? maskUrl(f.src) : undefined,
    });
  }

  const liveRows = perChannel.filter((p) => p.kind === "live");
  const vodRows = perChannel.filter((p) => p.kind === "vod");
  const avgOf = (rows: typeof perChannel) => {
    const d = rows.map((p) => p.deltaMs).filter((n): n is number => typeof n === "number");
    const avg = d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0;
    const med = d.length ? [...d].sort((a, b) => a - b)[Math.floor(d.length / 2)] : 0;
    return { avg, med, n: d.length };
  };
  const liveStats = avgOf(liveRows);
  const vodStats = avgOf(vodRows);

  const deltas = perChannel.map((p) => p.deltaMs).filter((n): n is number => typeof n === "number");
  const avgFirstFrame = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const medFirstFrame = deltas.length ? [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)] : 0;

  const winners: Record<string, number> = {};
  for (const c of calls) {
    if (c.uaWinner) winners[c.uaWinner] = (winners[c.uaWinner] || 0) + 1;
  }

  // eslint-disable-next-line no-console
  console.group("%c[PLAYBACK METRICS] resumo", "color:#0ff;font-weight:bold");
  // eslint-disable-next-line no-console
  console.log(`proxy calls: ${calls.length}`);
  // eslint-disable-next-line no-console
  console.log(`proxy ms — total ${fmt(sumMs)} | avg/call ${fmt(calls.length ? sumMs / calls.length : 0)}`);
  // eslint-disable-next-line no-console
  console.log(`status distribution:`, byStatus, `| suspected timeouts (~20s abort): ${timeouts}`);
  // eslint-disable-next-line no-console
  console.log(`UAs tentados por chamada — avg: ${avgAttempts.toFixed(2)}`);
  // eslint-disable-next-line no-console
  console.log(`UA vencedores:`, winners);
  // eslint-disable-next-line no-console
  console.log(`navegações p/ /player/live: ${navs.length} | first-frames capturados: ${frames.length}`);
  // eslint-disable-next-line no-console
  console.log(`tempo clique → 1º frame — avg ${fmt(avgFirstFrame)} | mediana ${fmt(medFirstFrame)} | amostras ${deltas.length}`);
  // eslint-disable-next-line no-console
  console.table(perChannel.map((p) => ({
    path: p.path,
    firstFrameMs: p.deltaMs ?? "—",
    src: p.src ?? "—",
  })));
  // eslint-disable-next-line no-console
  console.groupEnd();
}

function isInstalled(): boolean {
  return typeof window !== "undefined" && !!window.__playbackMetrics;
}

export function installPlaybackMetrics(): void {
  if (typeof window === "undefined" || isInstalled()) return;

  const state: Metrics = {
    proxyCalls: [],
    firstFrames: [],
    navigations: [],
    install() { /* no-op — already installed */ },
    report() { summarize(state); },
    reset() {
      state.proxyCalls.length = 0;
      state.firstFrames.length = 0;
      state.navigations.length = 0;
      // eslint-disable-next-line no-console
      console.log("[PLAYBACK METRICS] reset");
    },
  };

  window.__playbackMetrics = state;
  window.__playbackReport = () => summarize(state);
  window.__playbackReset = () => state.reset();

  // ---- fetch wrap (só /api/stream) ---------------------------------------
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const isProxy = rawUrl.includes("/api/stream?");
    if (!isProxy) return origFetch(input, init);

    let kind: string | null = null;
    let forcedUa: string | null = null;
    let upstreamHost = "";
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      kind = parsed.searchParams.get("kind");
      forcedUa = parsed.searchParams.get("ua");
      const u = parsed.searchParams.get("u");
      if (u) {
        try { upstreamHost = new URL(u).host; } catch { /* noop */ }
      }
    } catch { /* noop */ }

    const t0 = performance.now();
    try {
      const res = await origFetch(input, init);
      const t1 = performance.now();
      const uaTimings = res.headers.get("X-Proxy-UA-Timings") || undefined;
      const uaWinner = res.headers.get("X-Proxy-UA-Winner") || undefined;
      const uaAttemptsHdr = res.headers.get("X-Proxy-UA-Attempts");
      const uaAttempts = uaAttemptsHdr ? Number(uaAttemptsHdr) : undefined;
      state.proxyCalls.push({
        t0, t1, ms: t1 - t0,
        url: maskUrl(rawUrl),
        upstreamHost,
        kind, forcedUa,
        status: res.status,
        uaTimings, uaWinner, uaAttempts,
      });
      return res;
    } catch (e) {
      const t1 = performance.now();
      state.proxyCalls.push({
        t0, t1, ms: t1 - t0,
        url: maskUrl(rawUrl),
        upstreamHost,
        kind, forcedUa,
        status: 0,
      });
      throw e;
    }
  };

  // ---- video first-frame (capture phase; media events não bubblam) --------
  const seen = new WeakSet<HTMLVideoElement>();
  const onPlaying = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof HTMLVideoElement)) return;
    if (seen.has(t)) return;
    seen.add(t);
    state.firstFrames.push({ t: performance.now(), src: t.currentSrc || t.src || "" });
  };
  document.addEventListener("playing", onPlaying, true);
  document.addEventListener("loadeddata", onPlaying, true);

  // ---- navegação /player/{live,movie,series}/* (proxy p/ "clique") --------
  const kindOf = (p: string): "live" | "vod" | null => {
    if (/^\/player\/live\//.test(p)) return "live";
    if (/^\/player\/(movie|series)\//.test(p)) return "vod";
    return null;
  };
  let lastPath = window.location.pathname;
  const noteNav = () => {
    const p = window.location.pathname;
    if (p !== lastPath) {
      lastPath = p;
      const k = kindOf(p);
      if (k) state.navigations.push({ t: performance.now(), path: p, kind: k });
    }
  };
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args: Parameters<typeof origPush>) {
    const r = origPush(...args);
    queueMicrotask(noteNav);
    return r;
  };
  history.replaceState = function (...args: Parameters<typeof origReplace>) {
    const r = origReplace(...args);
    queueMicrotask(noteNav);
    return r;
  };
  window.addEventListener("popstate", noteNav);
  // Também captura navegação inicial se já entrar direto num /player/*.
  {
    const k = kindOf(lastPath);
    if (k) state.navigations.push({ t: performance.now(), path: lastPath, kind: k });
  }

  // eslint-disable-next-line no-console
  console.log(
    "%c[PLAYBACK METRICS] instalado — troque de canal ~20x e rode window.__playbackReport()",
    "color:#0ff;font-weight:bold",
  );
}
