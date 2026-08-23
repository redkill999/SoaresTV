// =========================================================================
// Playback Metrics — instrumentação TEMPORÁRIA (read-only) para medir onde
// o tempo é gasto na cadeia de reprodução. NÃO altera comportamento do
// player ou proxy. Só coleta e loga.
//
// Coleta:
//   - toda chamada a /api/stream (URL mascarada, status, timings, UA)
//   - eventos de mídia (loadedmetadata, canplay, playing, loadeddata) em
//     capture phase — media events não bubblam.
//   - clique bruto (pointerdown/click em capture)
//   - navegações /player/{live,movie,series}/*
//   - sessão de telemetria por playbackId (playback-telemetry.ts) para
//     amarrar eventos do VideoPlayer (create/attach/manifest/native).
//
// Uso:
//   installPlaybackMetrics() — chamado uma vez do __root.
//   window.__playbackReport() — timeline por sessão + agregações por
//                               host / pipeline / kind (avg, mediana,
//                               P90, P95, min, max, n).
//   window.__playbackReset()  — limpa amostras entre testes A/B.
// =========================================================================

import {
  beginPlaybackSession,
  getPlaybackSessions,
  markPlayback,
  resetPlaybackSessions,
  type PlaybackEvent,
  type PlaybackSession,
} from "./playback-telemetry";

type ProxyCall = {
  t0: number;
  t1: number;
  ms: number;
  url: string;
  upstreamHost: string;
  kind: string | null;
  forcedUa: string | null;
  status: number;
  uaTimings?: string;
  uaWinner?: string;
  uaAttempts?: number;
};

type Metrics = {
  proxyCalls: ProxyCall[];
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

// ---------- helpers ------------------------------------------------------

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
    grupo: label,
    n: s.n,
    avg: fmt(s.avg),
    mediana: fmt(s.med),
    P90: fmt(s.p90),
    P95: fmt(s.p95),
    min: fmt(s.min),
    max: fmt(s.max),
  };
}

// Ordem canônica dos eventos numa timeline de reprodução.
const EVENT_ORDER: PlaybackEvent[] = [
  "click",
  "router",
  "player-create-start",
  "player-create-end",
  "attach-media-start",
  "attach-media-end",
  "video-src-set",
  "native-open-start",
  "native-open-end",
  "manifest-parsed",
  "loadedmetadata",
  "canplay",
  "playing",
  "first-frame",
];

function firstEventT(s: PlaybackSession, name: PlaybackEvent): number | undefined {
  const e = s.events.find((e) => e.name === name);
  return e?.t;
}

// ---------- summary ------------------------------------------------------

function summarize(state: Metrics): void {
  const calls = state.proxyCalls;
  const sessions = getPlaybackSessions();

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
  const avgAttempts = attempts.length ? attempts.reduce((a, b) => a + b, 0) / attempts.length : 0;
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
  console.log(`sessões capturadas: ${sessions.length}`);

  // ---- Timelines por sessão --------------------------------------------
  console.group("timelines por playback");
  for (const s of sessions) {
    const clickT = firstEventT(s, "click");
    const baseT = clickT ?? firstEventT(s, "router") ?? s.createdAt;
    const rows: Array<{
      etapa: string;
      "abs (ms)": string;
      "Δ anterior": string;
      "Δ clique": string;
    }> = [];
    // Ordena eventos por ordem canônica quando ambos existem, senão por t.
    const ordered = [...s.events].sort((a, b) => {
      const ai = EVENT_ORDER.indexOf(a.name);
      const bi = EVENT_ORDER.indexOf(b.name);
      if (ai !== bi) return ai - bi;
      return a.t - b.t;
    });
    let prevT: number | undefined;
    for (const e of ordered) {
      rows.push({
        etapa: e.name,
        "abs (ms)": e.t.toFixed(0),
        "Δ anterior": prevT != null ? fmt(e.t - prevT) : "—",
        "Δ clique": fmt(e.t - baseT),
      });
      prevT = e.t;
    }
    console.groupCollapsed(
      `[${s.id}] ${s.kind ?? "?"} | ${s.pipeline ?? "?"} | host=${s.host ?? "?"} | proxy=${s.viaProxy === true ? "sim" : s.viaProxy === false ? "não" : "?"}`,
    );
    console.log("path:", s.path);
    if (s.url) console.log("url:", s.url);
    console.table(rows);
    console.groupEnd();
  }
  console.groupEnd();

  // ---- Agregações -------------------------------------------------------
  const collect = (
    predicate: (s: PlaybackSession) => boolean,
    fromEvt: PlaybackEvent,
    toEvt: PlaybackEvent,
  ) => {
    const out: number[] = [];
    for (const s of sessions) {
      if (!predicate(s)) continue;
      const a = firstEventT(s, fromEvt);
      const b = firstEventT(s, toEvt);
      if (a != null && b != null && b >= a) out.push(b - a);
    }
    return out;
  };

  const aggregate = (label: string, predicate: (s: PlaybackSession) => boolean) => {
    const total = collect(predicate, "router", "first-frame");
    const create = [
      ...collect(predicate, "player-create-start", "player-create-end"),
    ];
    const attach = collect(predicate, "attach-media-start", "attach-media-end");
    const routerToPlayer = collect(predicate, "router", "player-create-start");
    const parsedToPlaying = collect(predicate, "manifest-parsed", "playing");
    const playingToFirst = collect(predicate, "playing", "first-frame");
    const metaToCanplay = collect(predicate, "loadedmetadata", "canplay");
    return {
      label,
      total,
      routerToPlayer,
      create,
      attach,
      parsedToPlaying,
      metaToCanplay,
      playingToFirst,
    };
  };

  const groups: Array<{ label: string; predicate: (s: PlaybackSession) => boolean }> = [];
  // Por kind
  for (const k of ["live", "vod"] as const) {
    if (sessions.some((s) => s.kind === k)) {
      groups.push({ label: `kind=${k}`, predicate: (s) => s.kind === k });
    }
  }
  // Por pipeline
  const pipelines = Array.from(new Set(sessions.map((s) => s.pipeline).filter(Boolean))) as string[];
  for (const p of pipelines) {
    groups.push({ label: `pipeline=${p}`, predicate: (s) => s.pipeline === p });
  }
  // Por host
  const hosts = Array.from(new Set(sessions.map((s) => s.host).filter(Boolean))) as string[];
  for (const h of hosts) {
    groups.push({ label: `host=${h}`, predicate: (s) => s.host === h });
  }

  console.group("agregações (ms) — clique/router → primeiro frame");
  console.table(
    groups.map((g) => statsRow(g.label, statsOf(aggregate(g.label, g.predicate).total))),
  );
  console.groupEnd();

  console.group("agregações por fase — router → player-create-start");
  console.table(
    groups.map((g) => statsRow(g.label, statsOf(aggregate(g.label, g.predicate).routerToPlayer))),
  );
  console.groupEnd();

  console.group("agregações por fase — player create (start→end)");
  console.table(
    groups.map((g) => statsRow(g.label, statsOf(aggregate(g.label, g.predicate).create))),
  );
  console.groupEnd();

  console.group("agregações por fase — attachMedia (start→end)");
  console.table(
    groups.map((g) => statsRow(g.label, statsOf(aggregate(g.label, g.predicate).attach))),
  );
  console.groupEnd();

  console.group("agregações por fase — manifest-parsed → playing");
  console.table(
    groups.map((g) => statsRow(g.label, statsOf(aggregate(g.label, g.predicate).parsedToPlaying))),
  );
  console.groupEnd();

  console.group("agregações por fase — loadedmetadata → canplay");
  console.table(
    groups.map((g) => statsRow(g.label, statsOf(aggregate(g.label, g.predicate).metaToCanplay))),
  );
  console.groupEnd();

  console.group("agregações por fase — playing → first-frame");
  console.table(
    groups.map((g) => statsRow(g.label, statsOf(aggregate(g.label, g.predicate).playingToFirst))),
  );
  console.groupEnd();

  console.groupEnd();
  /* eslint-enable no-console */
}

function isInstalled(): boolean {
  return typeof window !== "undefined" && !!window.__playbackMetrics;
}

// ---------- install ------------------------------------------------------

export function installPlaybackMetrics(): void {
  if (typeof window === "undefined" || isInstalled()) return;

  const state: Metrics = {
    proxyCalls: [],
    install() { /* no-op */ },
    report() { summarize(state); },
    reset() {
      state.proxyCalls.length = 0;
      resetPlaybackSessions();
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
      if (state.proxyCalls.length > 300) state.proxyCalls.splice(0, state.proxyCalls.length - 300);
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

  // ---- video events (capture phase; media events não bubblam) ------------
  const seenFirstFrame = new WeakSet<HTMLVideoElement>();
  const seenMeta = new WeakSet<HTMLVideoElement>();
  const seenCanplay = new WeakSet<HTMLVideoElement>();
  const seenPlaying = new WeakSet<HTMLVideoElement>();

  const onFirstFrame = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof HTMLVideoElement)) return;
    if (seenFirstFrame.has(t)) return;
    seenFirstFrame.add(t);
    markPlayback("first-frame");
  };
  const onLoadedMeta = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof HTMLVideoElement)) return;
    if (seenMeta.has(t)) return;
    seenMeta.add(t);
    markPlayback("loadedmetadata");
  };
  const onCanPlay = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof HTMLVideoElement)) return;
    if (seenCanplay.has(t)) return;
    seenCanplay.add(t);
    markPlayback("canplay");
  };
  const onPlaying = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof HTMLVideoElement)) return;
    if (seenPlaying.has(t)) return;
    seenPlaying.add(t);
    markPlayback("playing");
  };

  document.addEventListener("loadedmetadata", onLoadedMeta, true);
  document.addEventListener("canplay", onCanPlay, true);
  document.addEventListener("playing", onPlaying, true);
  // Consideramos "first-frame" pelo primeiro loadeddata OU playing — o que
  // vier antes é o momento em que há de fato pixel na tela.
  document.addEventListener("loadeddata", onFirstFrame, true);
  document.addEventListener("playing", onFirstFrame, true);

  // ---- clique bruto ------------------------------------------------------
  let lastClickT: number | undefined;
  const noteClick = () => { lastClickT = performance.now(); };
  document.addEventListener("pointerdown", noteClick, true);
  document.addEventListener("click", noteClick, true);

  // ---- navegação /player/{live,movie,series}/* ---------------------------
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
        // Reseta "seens" — um novo playback vai reutilizar o mesmo <video>.
        // Como WeakSet não tem .clear(), recriar não é possível; em vez disso
        // usamos "current session" por playbackId — o mesmo elemento gera
        // eventos novos apenas depois de novo src, então na prática cada
        // sessão recebe seus eventos uma única vez (o browser dispara
        // loadedmetadata/canplay/playing novamente após src change).
        const now = performance.now();
        const clickT =
          lastClickT != null && now - lastClickT < 2_000 ? lastClickT : undefined;
        beginPlaybackSession({ path: p, kind: k, clickT, navT: now });
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

  // Captura navegação inicial se já entrar direto num /player/*.
  {
    const k = kindOf(lastPath);
    if (k) {
      beginPlaybackSession({ path: lastPath, kind: k, navT: performance.now() });
    }
  }

  // ---- Reset dos WeakSets em cada nova sessão de mídia -------------------
  // O <video> é reutilizado; para permitir capturar loadedmetadata/canplay/
  // playing na próxima reprodução, precisamos "esquecer" o elemento. Fazemos
  // isso escutando 'emptied' (disparado quando video.src muda / é removido).
  const onEmptied = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof HTMLVideoElement)) return;
    seenFirstFrame.delete(t);
    seenMeta.delete(t);
    seenCanplay.delete(t);
    seenPlaying.delete(t);
  };
  document.addEventListener("emptied", onEmptied, true);

  // eslint-disable-next-line no-console
  console.log(
    "%c[PLAYBACK METRICS] instalado — reproduza conteúdos e rode window.__playbackReport()",
    "color:#0ff;font-weight:bold",
  );
}
