// =========================================================================
// VOD Format-Error Diagnostics — instrumentação READ-ONLY.
//
// Dispara SOMENTE quando <video>.error.code === 4 (MEDIA_ERR_SRC_NOT_SUPPORTED
// / "Format error") em VOD. Não altera nenhum fluxo do player: apenas fetch
// range-limited (0-63 bytes) contra a mesma URL que o <video> tentou,
// classifica a causa em uma das 6 categorias, e empurra no
// window.__vodErrors. Dump por window.__vodReport().
//
// Objetivo: coletar evidência objetiva de quantos code=4 são causados por
// codec/container incompatível com o Chromium WebView vs. servidor devolvendo
// HTML/erro, antes de decidir habilitar ExoPlayer p/ VOD.
// =========================================================================
import { maskIptvUrl } from "@/lib/iptv-url";

type Category =
  | "codec-incompat-webview"
  | "container-incompat"
  | "mime-incorrect"
  | "invalid-server-response"
  | "corrupt-file"
  | "other";

export type VodErrorSample = {
  t: number;
  url: string;                 // mascarada
  extension: string;
  contentType: string;
  contentLength: string;
  acceptRanges: string;
  httpStatus: number;
  location: string;            // redirect final
  magic: string;               // hex, 16 primeiros bytes
  realContainer: string;       // mp4/mp2t/mkv/webm/riff/flv/m3u8/html/xml/json/unknown/empty
  mp4Brand?: string;
  canPlayTypeMp4H264: string;
  canPlayTypeMp4Hevc: string;
  canPlayTypeMp4Av1: string;
  canPlayTypeMkv: string;
  canPlayTypeWebmVp9: string;
  canPlayTypeMp2t: string;
  msIsTypeSupportedH264: boolean | null;
  msIsTypeSupportedHevc: boolean | null;
  msIsTypeSupportedAv1: boolean | null;
  proxyDetectedContainer: string;
  proxyDetectedMagic: string;
  wouldExoPlayerSupport: boolean; // heurística
  wouldFixWithExo: boolean;       // heurística
  category: Category;
  categoryReason: string;
};

declare global {
  interface Window {
    __vodErrors?: VodErrorSample[];
    __vodReport?: () => void;
    __vodReportJson?: () => string;
    __vodReset?: () => void;
  }
}

function ensureStore(): VodErrorSample[] {
  if (typeof window === "undefined") return [];
  if (!window.__vodErrors) {
    window.__vodErrors = [];
    window.__vodReport = () => reportVod();
    window.__vodReportJson = () => buildVodReportJson();
    window.__vodReset = () => { if (window.__vodErrors) window.__vodErrors.length = 0; };
  }
  return window.__vodErrors;
}


function extOf(url: string): string {
  try {
    const p = new URL(url, typeof location !== "undefined" ? location.origin : "http://x").pathname.toLowerCase();
    const m = p.match(/\.([a-z0-9]{1,5})$/);
    return m ? m[1] : "";
  } catch { return ""; }
}

function detectContainerFromBytes(bytes: Uint8Array): { kind: string; brand?: string } {
  if (!bytes.length) return { kind: "empty" };
  if (bytes[0] === 0x47 && (bytes.length < 189 || bytes[188] === 0x47)) return { kind: "mp2t" };
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).replace(/[^\x20-\x7e]/g, "");
    return { kind: "mp4", brand };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { kind: "mkv" };
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return { kind: "riff" };
  if (bytes.length >= 4 && bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x56 && bytes[3] === 0x01) return { kind: "flv" };
  try {
    const head = new TextDecoder().decode(bytes.slice(0, 64)).toLowerCase();
    if (head.startsWith("#extm3u")) return { kind: "m3u8" };
    if (head.startsWith("<!doctype") || head.startsWith("<html")) return { kind: "html" };
    if (head.startsWith("<?xml")) return { kind: "xml" };
    if (head.startsWith("{") || head.startsWith("[")) return { kind: "json" };
  } catch { /* noop */ }
  return { kind: "unknown" };
}

function magicHex(bytes: Uint8Array, n = 16): string {
  const out: string[] = [];
  for (let i = 0; i < Math.min(n, bytes.length); i++) out.push(bytes[i].toString(16).padStart(2, "0"));
  return out.join(" ");
}

function tryIsTypeSupported(mime: string): boolean | null {
  try {
    if (typeof MediaSource === "undefined") return null;
    return MediaSource.isTypeSupported(mime);
  } catch { return null; }
}

function classify(sample: Omit<VodErrorSample, "category" | "categoryReason" | "wouldExoPlayerSupport" | "wouldFixWithExo">): {
  category: Category; reason: string; wouldExo: boolean; wouldFix: boolean;
} {
  const rc = sample.realContainer;
  // 4. Resposta inválida do servidor
  if (rc === "html" || rc === "xml" || rc === "json") {
    return { category: "invalid-server-response", reason: `body starts with ${rc}`, wouldExo: false, wouldFix: false };
  }
  if (sample.httpStatus >= 400) {
    return { category: "invalid-server-response", reason: `http ${sample.httpStatus}`, wouldExo: false, wouldFix: false };
  }
  if (rc === "empty") {
    return { category: "invalid-server-response", reason: "empty body", wouldExo: false, wouldFix: false };
  }

  // 3. MIME incorreto (o servidor manda CT que discorda do magic real)
  const ctLow = sample.contentType.toLowerCase();
  const ctMatchesReal =
    (rc === "mp4"  && /mp4|quicktime|iso|isom|octet-stream|binary/.test(ctLow)) ||
    (rc === "mp2t" && /mp2t|mpegts|octet-stream|binary/.test(ctLow)) ||
    (rc === "mkv"  && /matroska|webm|octet-stream|binary/.test(ctLow)) ||
    (rc === "flv"  && /flv|octet-stream|binary/.test(ctLow)) ||
    (rc === "riff" && /avi|msvideo|octet-stream|binary/.test(ctLow)) ||
    (rc === "m3u8" && /mpegurl/.test(ctLow));
  const ctIsGeneric = !ctLow || /octet-stream|binary|text\/plain/.test(ctLow);

  // 2. Container incompatível (Chromium não abre MKV/AVI/FLV nativamente)
  if (rc === "mkv" || rc === "riff" || rc === "flv") {
    return {
      category: "container-incompat",
      reason: `container ${rc} not supported by <video>`,
      wouldExo: true,
      wouldFix: true,
    };
  }

  // 1. Codec incompatível com Chromium WebView.
  // Heurística: quando o container é MP4/TS mas o Chromium falhou, o culpado
  // mais provável é HEVC/AV1/AC3/EAC3 (formatos comuns em catálogos IPTV que
  // o Chromium stock não decodifica). ExoPlayer/Media3 tem esses codecs em HW.
  if (rc === "mp4" || rc === "mp2t") {
    // Se o MIME contradiz o real, ainda assim priorizamos "codec incompat"
    // porque MP4 real ⇒ o <video> deveria abrir se fosse H.264/AAC.
    // ExoPlayer resolve tanto codec quanto o container MP2T-em-URL-.mp4.
    return {
      category: "codec-incompat-webview",
      reason: `real=${rc}${sample.mp4Brand ? "/" + sample.mp4Brand : ""}; Chromium falhou apesar do container ser suportado (provável HEVC/AV1/AC3)`,
      wouldExo: true,
      wouldFix: true,
    };
  }

  if (!ctMatchesReal && !ctIsGeneric) {
    return { category: "mime-incorrect", reason: `ct=${ctLow} vs real=${rc}`, wouldExo: true, wouldFix: true };
  }

  // 5. Arquivo corrompido (mp4 sem ftyp, tamanho ínfimo, etc.)
  if (rc === "unknown") {
    return { category: "corrupt-file", reason: "no known signature in first bytes", wouldExo: false, wouldFix: false };
  }

  return { category: "other", reason: `real=${rc} ct=${ctLow}`, wouldExo: false, wouldFix: false };
}

export async function diagnoseVodFormatError(
  currentSrc: string,
  video: HTMLVideoElement,
  pushDbg: (s: string) => void,
): Promise<VodErrorSample | null> {
  if (typeof window === "undefined" || !currentSrc) return null;
  const store = ensureStore();
  const extension = extOf(currentSrc);

  let contentType = "";
  let contentLength = "";
  let acceptRanges = "";
  let httpStatus = 0;
  let location = "";
  let magic = "";
  let real: { kind: string; brand?: string } = { kind: "unknown" };
  let proxyDetectedContainer = "";
  let proxyDetectedMagic = "";

  try {
    const res = await fetch(currentSrc, {
      method: "GET",
      headers: { Range: "bytes=0-63", Accept: "*/*" },
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
    });
    httpStatus = res.status;
    contentType = res.headers.get("content-type") || "";
    contentLength = res.headers.get("content-length") || "";
    acceptRanges = res.headers.get("accept-ranges") || "";
    location = res.headers.get("location") || res.url || "";
    proxyDetectedContainer = res.headers.get("x-proxy-detected-container") || "";
    proxyDetectedMagic = res.headers.get("x-proxy-magic") || "";
    const buf = new Uint8Array(await res.arrayBuffer());
    magic = magicHex(buf);
    real = detectContainerFromBytes(buf);
  } catch (e) {
    pushDbg(`[VOD-DIAG] probe fetch failed: ${(e as Error).message}`);
  }

  const canPlayTypeMp4H264 = video.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  const canPlayTypeMp4Hevc = video.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"');
  const canPlayTypeMp4Av1  = video.canPlayType('video/mp4; codecs="av01.0.05M.08"');
  const canPlayTypeMkv     = video.canPlayType("video/x-matroska");
  const canPlayTypeWebmVp9 = video.canPlayType('video/webm; codecs="vp9, opus"');
  const canPlayTypeMp2t    = video.canPlayType("video/mp2t");
  const msH264 = tryIsTypeSupported('video/mp4; codecs="avc1.42E01E"');
  const msHevc = tryIsTypeSupported('video/mp4; codecs="hvc1.1.6.L120.90"');
  const msAv1  = tryIsTypeSupported('video/mp4; codecs="av01.0.05M.08"');

  const partial: Omit<VodErrorSample, "category" | "categoryReason" | "wouldExoPlayerSupport" | "wouldFixWithExo"> = {
    t: Date.now(),
    url: maskIptvUrl(currentSrc),
    extension,
    contentType,
    contentLength,
    acceptRanges,
    httpStatus,
    location: location ? maskIptvUrl(location) : "",
    magic,
    realContainer: real.kind,
    mp4Brand: real.brand,
    canPlayTypeMp4H264,
    canPlayTypeMp4Hevc,
    canPlayTypeMp4Av1,
    canPlayTypeMkv,
    canPlayTypeWebmVp9,
    canPlayTypeMp2t,
    msIsTypeSupportedH264: msH264,
    msIsTypeSupportedHevc: msHevc,
    msIsTypeSupportedAv1: msAv1,
    proxyDetectedContainer,
    proxyDetectedMagic,
  };
  const c = classify(partial);
  const sample: VodErrorSample = {
    ...partial,
    category: c.category,
    categoryReason: c.reason,
    wouldExoPlayerSupport: c.wouldExo,
    wouldFixWithExo: c.wouldFix,
  };
  store.push(sample);
  // Cap de memória: em sessões longas no APK esse array crescia sem limite
  // (cada sample carrega URL, headers e magic bytes).
  if (store.length > 50) store.splice(0, store.length - 50);
  pushDbg(
    `[VOD-DIAG] ext=${extension} ct=${contentType || "-"} real=${real.kind}${real.brand ? "/" + real.brand : ""} magic=[${magic}] status=${httpStatus} → ${c.category} (${c.reason})`,
  );
  return sample;
}


export function reportVod(): void {
  if (typeof window === "undefined") return;
  const rows = window.__vodErrors || [];
  if (!rows.length) {
    // eslint-disable-next-line no-console
    console.log("[VOD-DIAG] nenhum erro code=4 registrado ainda");
    return;
  }
  const byCat: Record<string, number> = {};
  let exoWouldFix = 0;
  for (const r of rows) {
    byCat[r.category] = (byCat[r.category] || 0) + 1;
    if (r.wouldFixWithExo) exoWouldFix++;
  }
  const pct = (n: number) => `${((n / rows.length) * 100).toFixed(0)}%`;
  // eslint-disable-next-line no-console
  console.group("%c[VOD-DIAG] resumo de code=4", "color:#f80;font-weight:bold");
  // eslint-disable-next-line no-console
  console.log(`total: ${rows.length}`);
  // eslint-disable-next-line no-console
  console.log("por categoria:", Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, `${v} (${pct(v)})`])));
  // eslint-disable-next-line no-console
  console.log(`ExoPlayer resolveria: ${exoWouldFix}/${rows.length} (${pct(exoWouldFix)})`);
  // eslint-disable-next-line no-console
  console.table(rows.map((r) => ({
    category: r.category,
    real: r.realContainer + (r.mp4Brand ? "/" + r.mp4Brand : ""),
    ext: r.extension,
    ct: r.contentType,
    status: r.httpStatus,
    magic: r.magic,
    mp4Hevc: r.canPlayTypeMp4Hevc || "-",
    msHevc: r.msIsTypeSupportedHevc,
    exoFix: r.wouldFixWithExo,
    url: r.url,
  })));
  // eslint-disable-next-line no-console
  console.groupEnd();
}

export function buildVodReportJson(): string {
  const rows = (typeof window !== "undefined" && window.__vodErrors) || [];
  const byCat: Record<string, number> = {};
  let exoWouldFix = 0;
  for (const r of rows) {
    byCat[r.category] = (byCat[r.category] || 0) + 1;
    if (r.wouldFixWithExo) exoWouldFix++;
  }
  const summary = {
    total: rows.length,
    exoWouldFix,
    byCategory: byCat,
    generatedAt: new Date().toISOString(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
  return JSON.stringify({ summary, samples: rows }, null, 2);
}

