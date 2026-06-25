import { useEffect, useState } from "react";
import { detectPlatform } from "@/lib/platform-flags";

// Overlay TEMPORÁRIO de diagnóstico VOD.
// Como remover: deletar este arquivo e o trecho `<VodDebugOverlay .../>` em
// `src/components/VideoPlayer.tsx` (procurar por "VodDebugOverlay").

type ProxyDiag = {
  error?: string;
  phase?: string;
  upstream_status?: number | null;
  upstream_url?: string;
  final_url?: string;
  content_type?: string | null;
  redirect_count?: number;
  redirects?: number;
  redirect_location?: string | null;
  direct_candidate?: string | null;
  candidate?: string | null;
  failure_class?: string | null;
  dead_media_bases?: string[] | null;
  ua_last?: string | null;
  exception_message?: string | null;
  exception_stack?: string | null;
  attempts_total?: number;
  attempts?: unknown[];
};

type Props = {
  src: string;
  errorMessage: string;
  kind: "movie" | "series" | "vod";
  onClose: () => void;
};

function classifyTag(d: ProxyDiag | null, errorMessage: string): string {
  const phase = (d?.phase || "").toLowerCase();
  const fc = (d?.failure_class || "").toLowerCase();
  const status = d?.upstream_status ?? 0;
  if (phase === "upstream-timeout") return "TIMEOUT";
  if (phase === "fetch-exception") return "FETCH EXCEPTION";
  if (status === 403) return "403";
  if (status === 404 || fc.includes("not-found")) return "404";
  if (fc.includes("dns") || /ENOTFOUND|EAI_AGAIN/i.test(d?.exception_message ?? "")) return "DNS ERROR";
  if (fc.includes("html") || /text\/html|application\/json/i.test(d?.content_type ?? "")) return "CONTENT-TYPE INVALID";
  if ((d?.redirect_count ?? d?.redirects ?? 0) > 8) return "REDIRECT LOOP";
  if (/timeout/i.test(errorMessage)) return "TIMEOUT";
  if (status >= 500) return `UPSTREAM ${status}`;
  if (status) return `UPSTREAM ${status}`;
  return "PLAYER FAILURE";
}

function phaseLabel(d: ProxyDiag | null): string {
  const p = d?.phase || "PLAYER";
  if (p === "fetch-exception") return "PROXY (FETCH)";
  if (p === "upstream-timeout") return "PROXY (TIMEOUT)";
  if (p.startsWith("upstream-")) return `PROXY (${p.replace("upstream-", "")})`;
  if (p === "vod-placeholder-not-found") return "PROXY (PLACEHOLDER 404)";
  return p.toUpperCase();
}

export function VodDebugOverlay({ src, errorMessage, kind, onClose }: Props) {
  const [diag, setDiag] = useState<ProxyDiag | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const probeUrl = `/api/stream?u=${encodeURIComponent(src)}&kind=vod&probe=1&v=7`;
    setLoading(true);
    setProbeError(null);
    fetch(probeUrl, { method: "GET" })
      .then(async (res) => {
        const text = await res.text();
        if (cancelled) return;
        try {
          setDiag(JSON.parse(text) as ProxyDiag);
        } catch {
          setDiag({
            error: `NON_JSON_${res.status}`,
            phase: res.status >= 500 ? "upstream-timeout" : "fetch-exception",
            upstream_status: res.status,
            upstream_url: src,
            final_url: res.headers.get("x-upstream-final-url") || src,
            content_type: res.headers.get("x-upstream-content-type"),
            redirect_count: Number(res.headers.get("x-upstream-redirected") === "1" ? 1 : 0),
            failure_class: res.headers.get("x-upstream-failure-class"),
            ua_last: res.headers.get("x-upstream-user-agent"),
            exception_message: text.slice(0, 400) || null,
            exception_stack: null,
          });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e as { name?: string; message?: string; stack?: string };
        setProbeError(err?.message || String(e));
        setDiag({
          error: "PROBE_FETCH_FAILED",
          phase: "fetch-exception",
          upstream_url: src,
          exception_message: err?.message || String(e),
          exception_stack: err?.stack || null,
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  const platform = detectPlatform();
  const tag = classifyTag(diag, errorMessage);
  const phase = phaseLabel(diag);
  const redirectCount = diag?.redirect_count ?? diag?.redirects ?? 0;
  const candidate = diag?.candidate ?? diag?.direct_candidate ?? src;

  const rows: Array<[string, string]> = [
    ["Platform", platform],
    ["candidate", candidate || "-"],
    ["kind", kind],
    ["phase", phase],
    ["upstream_url", diag?.upstream_url ?? src],
    ["final_url", diag?.final_url ?? "-"],
    ["upstream_status", String(diag?.upstream_status ?? "-")],
    ["content_type", diag?.content_type ?? "-"],
    ["redirect_count", String(redirectCount)],
    ["probe", loading ? "loading…" : probeError ? `error: ${probeError}` : "ok"],
    ["error", errorMessage || diag?.error || "-"],
    ["exception_message", diag?.exception_message ?? "-"],
    ["exception_stack", diag?.exception_stack ? diag.exception_stack.slice(0, 600) : "-"],
  ];

  const debugText = [
    "## VOD DEBUG",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    `failure_class: ${diag?.failure_class ?? "-"}`,
    `redirect_location: ${diag?.redirect_location ?? "-"}`,
    `direct_candidate: ${diag?.direct_candidate ?? "-"}`,
    `ua_last: ${diag?.ua_last ?? "-"}`,
    `attempts_total: ${diag?.attempts_total ?? "-"}`,
    `dead_media_bases: ${diag?.dead_media_bases?.join(", ") ?? "-"}`,
    "",
    "RAW JSON:",
    JSON.stringify(diag, null, 2),
  ].join("\n");

  const handleCopy = () => {
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = debugText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* noop */ }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(debugText).catch(fallback);
    } else {
      fallback();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const tagColor =
    tag === "404" || tag.includes("PLACEHOLDER") ? "bg-amber-500 text-black"
    : tag === "403" ? "bg-orange-500 text-black"
    : tag === "TIMEOUT" ? "bg-yellow-400 text-black"
    : tag === "DNS ERROR" || tag === "FETCH EXCEPTION" ? "bg-red-600 text-white"
    : tag === "REDIRECT LOOP" ? "bg-fuchsia-500 text-white"
    : tag === "CONTENT-TYPE INVALID" ? "bg-purple-500 text-white"
    : "bg-slate-500 text-white";

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-3">
      <div className="max-h-full w-full max-w-2xl overflow-auto rounded-lg border border-white/20 bg-zinc-950/95 p-4 font-mono text-[11px] text-white shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-wider">VOD DEBUG</span>
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${tagColor}`}>{tag}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded border border-white/30 bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider hover:bg-white/20"
            >
              {copied ? "COPIADO ✓" : "COPIAR DEBUG"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar diagnóstico"
              className="rounded border border-white/30 bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider hover:bg-white/20"
            >
              FECHAR
            </button>
          </div>
        </div>
        <div className="space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[140px_1fr] gap-2 border-b border-white/5 py-1">
              <span className="text-white/50">{k}</span>
              <span className="break-all text-white/95 whitespace-pre-wrap">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded bg-black/60 p-2 text-[10px] leading-snug text-emerald-200/90">
          <div className="mb-1 font-bold text-white/70">RAW JSON</div>
          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(diag, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
