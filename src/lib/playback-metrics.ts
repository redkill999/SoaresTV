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
//   - clique bruto (pointerdown/click em capture) — para medir a fase
//     "clique → Router" separadamente.
//   - navegação para /player/{live,movie,series}/*.
//
// Uso:
//   - installPlaybackMetrics() chamado uma vez do __root em client-only.
//   - window.__playbackReport()  → tabela + estatísticas (avg, mediana,
//                                  P90, P95, min, max) e fases.
//   - window.__playbackReset()   → limpa amostras entre testes A/B.
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
  clickT?: number; // clique bruto associado (pointerdown/click < nav)
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

function fmt(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return `${ms.toFixed(0)}ms`;
}

function percentile(sorted: number[], p: number): number | undefined {
  if (!sorted.length) return undefined;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

type Stats = {
  n: number;
  avg?: number;
  med?: number;
  p90?: number;
  p95?: number;
  min?: number;
  max?: number;
};

function statsOf(values: number[]): Stats {
  const d = values.filter((n) => Number.isFinite(n));
  if (!d.length) return { n: 0 };
  const sorted = [...d].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    avg: sum / sorted.length,
    med: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function statsRow(label: string, s: Stats) {
  return {
    métrica: label,
    n: s.n,
    avg: fmt(s.avg),
    mediana: fmt(s.med),
    P90: fmt(s.p90),
    P95: fmt(s.p95),
    min: fmt(s.min),
    max: fmt(s.max),
  };
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

  // Match navigate → first frame + fases por navegação.
  type Row = {
    kind: "live" | "vod";
    path: string;
    clickToRouterMs?: number;
    routerToProxyMs?: number;
    proxyMs?: number;
    manifestToFrameMs?: number;
    totalMs?: number;
    src?: string;
  };
  const perChannel: Row[] = [];

  for (let i = 0; i < navs.length; i++) {
    const n = navs[i];
    const nextNavT = i + 1 < navs.length ? navs[i + 1].t : Number.POSITIVE_INFINITY;
    const windowEnd = Math.min(nextNavT, n.t + 60_000);

    const f = frames.find((f) => f.t > n.t && f.t < windowEnd);
    // Primeira chamada de proxy DEPOIS da navegação e ANTES do primeiro
    // frame (ou dentro da janela). Serve como proxy do "manifest recebido".
    const proxyEnd = f ? f.t : windowEnd;
    const firstProxy = calls.find((c) => c.t0 >= n.t && c.t0 < proxyEnd);

    const clickToRouterMs =
      n.clickT != null && n.t >= n.clickT ? n.t - n.clickT : undefined;
    const routerToProxyMs = firstProxy ? firstProxy.t0 - n.t : undefined;
    const proxyMs = firstProxy ? firstProxy.ms : undefined;
    const manifestToFrameMs =
      f && firstProxy ? f.t - firstProxy.t1 : undefined;
    const totalMs = f ? f.t - n.t : undefined;

    perChannel.push({
      kind: n.kind,
      path: n.path,
      clickToRouterMs,
      routerToProxyMs,
      proxyMs,
      manifestToFrameMs,
      totalMs,
      src: f?.src ? maskUrl(f.src) : undefined,
    });
  }

  const liveRows = perChannel.filter((p) => p.kind === "live");
  const vodRows = perChannel.filter((p) => p.kind === "vod");

  const collectTotal = (rows: Row[]) =>
    rows.map((r) => r.totalMs).filter((n): n is number => typeof n === "number");
  const collect = (rows: Row[], key: keyof Row) =>
    rows.map((r) => r[key]).filter((n): n is number => typeof n === "number");

  const winners: Record<string, number> = {};
  for (const c of calls) {
    if (c.uaWinner) winners[c.uaWinner] = (winners[c.uaWinner] || 0) + 1;
  }

  const flags =
    typeof window !== "undefined" && window.__perfFlags
      ? { ...window.__perfFlags }
      : undefined;

  /* eslint-disable no-console */
  console.group("%c[PLAYBACK METRICS] resumo", "color:#0ff;font-weight:bold");
  if (flags) console.log("perfFlags:", flags);
  console.log(`proxy calls: ${calls.length}`);
  console.log(
    `proxy ms — total ${fmt(sumMs)} | avg/call ${fmt(calls.length ? sumMs / calls.length : 0)}`,
  );
  console.log(`status distribution:`, byStatus, `| suspected timeouts (~20s abort): ${timeouts}`);
  console.log(`UAs tentados por chamada — avg: ${avgAttempts.toFixed(2)}`);
  console.log(`UA vencedores:`, winners);
  console.log(
    `navegações totais: ${navs.length} (live=${liveRows.length} vod=${vodRows.length}) | first-frames capturados: ${frames.length}`,
  );

  console.group("clique → 1º frame (estatísticas)");
  console.table([
    statsRow("LIVE total", statsOf(collectTotal(liveRows))),
    statsRow("VOD  total", statsOf(collectTotal(vodRows))),
  ]);
  console.groupEnd();

  console.group("fases — LIVE (ms)");
  console.table([
    statsRow("clique → Router",       statsOf(collect(liveRows, "clickToRouterMs"))),
    statsRow("Router → proxy start",  statsOf(collect(liveRows, "routerToProxyMs"))),
    statsRow("proxy (manifest) dur",  statsOf(collect(liveRows, "proxyMs"))),
    statsRow("manifest → 1º frame",   statsOf(collect(liveRows, "manifestToFrameMs"))),
  ]);
  console.groupEnd();

  console.group("fases — VOD (ms)");
  console.table([
    statsRow("clique → Router",       statsOf(collect(vodRows, "clickToRouterMs"))),
    statsRow("Router → proxy start",  statsOf(collect(vodRows, "routerToProxyMs"))),
    statsRow("proxy (manifest) dur",  statsOf(collect(vodRows, "proxyMs"))),
    statsRow("manifest → 1º frame",   statsOf(collect(vodRows, "manifestToFrameMs"))),
  ]);
  console.groupEnd();

  console.group("por navegação (detalhado)");
  console.table(
    perChannel.map((p) => ({
      kind: p.kind,
      path: p.path,
      "clk→router":    fmt(p.clickToRouterMs),
      "router→proxy":  fmt(p.routerToProxyMs),
      "proxy":         fmt(p.proxyMs),
      "manif→frame":   fmt(p.manifestToFrameMs),
      total:           fmt(p.totalMs),
      src: p.src ?? "—",
    })),
  );
  console.groupEnd();

  console.groupEnd();
  /* eslint-enable no-console */
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

  // ---- clique bruto (fase "clique → Router") ------------------------------
  // Captura o instante do último pointerdown/click em capture. Depois, no
  // pushState, associamos esse clique à navegação se estiver a < 2s.
  let lastClickT: number | undefined;
  const noteClick = () => { lastClickT = performance.now(); };
  document.addEventListener("pointerdown", noteClick, true);
  document.addEventListener("click", noteClick, true);

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
      if (k) {
        const now = performance.now();
        const clickT =
          lastClickT != null && now - lastClickT < 2_000 ? lastClickT : undefined;
        state.navigations.push({ t: now, path: p, kind: k, clickT });
      }
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
