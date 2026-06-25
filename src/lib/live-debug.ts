// ============================================================================
// [LIVE DEBUG] Diagnóstico cirúrgico para canais ao vivo (LIVE).
// ----------------------------------------------------------------------------
// NÃO altera lógica de reprodução. Roda em paralelo ao playback, faz probe
// HEAD via /api/stream (que reescreve User-Agent) ciclando UAs típicos de
// apps IPTV. Loga STATUS, CONTENT-TYPE, ACCEPT-RANGES, CONTENT-LENGTH,
// URL final upstream e UA que respondeu.
// Não toca em VOD, séries, filmes, login, layout, cache ou EPG.
// ============================================================================

export const LIVE_UAS = {
  XCIPTV:        "XCIPTV/7.0 (Linux; Android 13)",
  TiviMate:      "TiviMate/4.7.0 (Linux; Android 13)",
  IPTVSmarters:  "IPTVSmartersPro/3.1.5",
  okhttp:        "okhttp/4.12.0",
  VLC:           "VLC/3.0.20 LibVLC/3.0.20",
} as const;

export type LiveUaName = keyof typeof LIVE_UAS;

export type LiveProbeResult = {
  ua: LiveUaName | "preferred";
  uaString: string;
  status: number;
  upstreamStatus: number | null;
  contentType: string;
  acceptRanges: string;
  contentLength: string;
  finalUrl: string;
  redirected: boolean;
  ok: boolean;
  error?: string;
};

export type LiveProbeReport = {
  originalUrl: string;
  tried: LiveProbeResult[];
  best: LiveProbeResult | null;
};

function num(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function probeOnce(url: string, ua: string, name: LiveUaName | "preferred", timeoutMs = 6000): Promise<LiveProbeResult> {
  const proxy = `/api/stream?u=${encodeURIComponent(url)}&ua=${encodeURIComponent(ua)}&v=7`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(proxy, { method: "HEAD", signal: ctrl.signal });
    const upstreamStatus = num(res.headers.get("X-Upstream-Status"));
    const status = upstreamStatus ?? res.status;
    return {
      ua: name,
      uaString: ua,
      status,
      upstreamStatus,
      contentType: res.headers.get("X-Upstream-Content-Type") ?? res.headers.get("content-type") ?? "",
      acceptRanges: res.headers.get("accept-ranges") ?? "",
      contentLength: res.headers.get("content-length") ?? "",
      finalUrl: res.headers.get("X-Upstream-Final-Url") ?? url,
      redirected: (res.headers.get("X-Upstream-Redirected") ?? "0") === "1",
      ok: status >= 200 && status < 400,
    };
  } catch (e) {
    return {
      ua: name, uaString: ua, status: 0, upstreamStatus: null,
      contentType: "", acceptRanges: "", contentLength: "",
      finalUrl: url, redirected: false, ok: false,
      error: (e as Error).message,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Faz probe do canal LIVE. Se o UA preferido responder 200..399, para ali.
 * Em 401/403, cicla UAs (XCIPTV → TiviMate → IPTVSmarters → okhttp → VLC).
 * Em qualquer outro status (404/5xx/timeout), também tenta os demais UAs
 * — pode ser bloqueio anti-bot por UA, não só auth.
 */
export async function probeLiveStream(url: string, preferredUa?: string | null): Promise<LiveProbeReport> {
  const tried: LiveProbeResult[] = [];
  const order: Array<{ name: LiveUaName | "preferred"; ua: string }> = [];
  if (preferredUa) order.push({ name: "preferred", ua: preferredUa });
  for (const [name, ua] of Object.entries(LIVE_UAS) as Array<[LiveUaName, string]>) {
    if (!order.some(o => o.ua === ua)) order.push({ name, ua });
  }

  let best: LiveProbeResult | null = null;
  for (const { name, ua } of order) {
    const r = await probeOnce(url, ua, name);
    tried.push(r);
    if (r.ok) { best = r; break; }
    // Em 401/403 continua ciclando UA. Em outros erros, ainda tenta os
    // restantes mas guarda o melhor visto até agora.
    if (!best || (r.status && (!best.status || best.status === 0))) best = r;
  }
  return { originalUrl: url, tried, best };
}

/** Mapeia content-type para o tipo de mídia. application/octet-stream → "ts" */
export function liveContentKind(ct: string): "hls" | "ts" | "mp4" | "unknown" {
  const c = (ct || "").toLowerCase().split(";")[0].trim();
  if (!c) return "unknown";
  if (c.includes("mpegurl")) return "hls";                  // application/vnd.apple.mpegurl, audio/x-mpegurl
  if (c === "video/mp2t" || c === "video/mpeg") return "ts";
  if (c === "application/octet-stream") return "ts";        // muitos painéis IPTV
  if (c === "video/mp4" || c === "video/m4v") return "mp4";
  return "unknown";
}

/** Loga o relatório no console com formatação consistente. */
export function logLiveProbeReport(report: LiveProbeReport, ctx: { originalSrc: string; finalCandidates: string[] }): void {
  try {
    console.groupCollapsed("[LIVE DEBUG] RELATÓRIO DE PROBE");
    console.log("URL ORIGINAL:", ctx.originalSrc);
    console.log("URL PROBADA :", report.originalUrl);
    console.log("CANDIDATOS DE PLAYBACK (ordem):", ctx.finalCandidates);
    for (const r of report.tried) {
      console.log(`[UA=${r.ua}]`, {
        uaString: r.uaString,
        status: r.status,
        contentType: r.contentType || "(vazio)",
        kind: liveContentKind(r.contentType),
        acceptRanges: r.acceptRanges || "(vazio)",
        contentLength: r.contentLength || "(vazio)",
        finalUrl: r.finalUrl,
        redirected: r.redirected,
        error: r.error ?? null,
      });
    }
    if (report.best?.ok) {
      console.log("MELHOR RESULTADO:", {
        ua: report.best.ua,
        uaString: report.best.uaString,
        status: report.best.status,
        contentType: report.best.contentType,
        kind: liveContentKind(report.best.contentType),
      });
    } else {
      console.warn("PROBE NÃO OBTEVE 2xx/3xx EM NENHUM UA — canal provavelmente offline, host bloqueando, ou credencial expirada.");
    }
    console.groupEnd();
  } catch { /* noop */ }
}
