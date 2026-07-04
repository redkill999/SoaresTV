// Helpers puros para o relay /api/live-stream e o diagnóstico manual
// /api/live-diagnose. Separados dos route files para facilitar testes
// unitários sem tocar em fetch/streams reais.

/** Timeout do primeiro byte do upstream (relay e diagnóstico). */
export const LIVE_FIRST_BYTE_TIMEOUT_MS = 8_000;
/** Limite duro de leitura do diagnóstico manual (spec V5 §2). */
export const LIVE_DIAGNOSE_MAX_BYTES = 64 * 1024;
/** Amostra mínima desejada para classificar o corpo com segurança. */
export const LIVE_DIAGNOSE_MIN_SAMPLE_BYTES = 4_096;
/** Tempo extra máximo de leitura após o primeiro chunk no diagnóstico. */
export const LIVE_DIAGNOSE_EXTRA_READ_MS = 1_200;

/** Procura sincronização MPEG-TS: byte 0x47 em offset X, X+188 e (quando o
 *  buffer alcança) X+376. Retorna o offset da sincronização ou -1. Não exige
 *  que o primeiro byte seja 0x47 — o chunk pode começar no meio de um pacote
 *  (spec V5 §4). */
export function findMpegTsSync(data: Uint8Array): number {
  const maximumOffset = Math.min(188, data.length);
  for (let offset = 0; offset < maximumOffset; offset++) {
    if (data[offset] !== 0x47) continue;
    const secondPacket = offset + 188;
    const thirdPacket = offset + 376;
    const hasSecond = secondPacket < data.length && data[secondPacket] === 0x47;
    const hasThird = thirdPacket >= data.length || data[thirdPacket] === 0x47;
    if (hasSecond && hasThird) return offset;
  }
  return -1;
}

/** Classificação sanitizada do corpo devolvido pelo upstream (spec V5 §4).
 *  Nunca devolve o conteúdo — apenas o tipo. */
export type LiveBodyKind = "mpegts" | "html" | "json" | "text" | "unknown";

export function classifyBodyKind(data: Uint8Array): LiveBodyKind {
  if (data.length === 0) return "unknown";
  if (findMpegTsSync(data) >= 0) return "mpegts";
  const sampleLen = Math.min(256, data.length);
  let printable = 0;
  for (let i = 0; i < sampleLen; i++) {
    const b = data[i];
    if ((b >= 32 && b < 127) || b === 9 || b === 10 || b === 13) printable++;
  }
  if (printable / sampleLen < 0.85) return "unknown";
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(data.subarray(0, sampleLen))
    .trim()
    .toLowerCase();
  if (!head) return "unknown";
  if (head.startsWith("<")) return "html";
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  return "text";
}

/** Detecta corpo textual óbvio (HTML, JSON, mensagem de erro plana) no início
 *  de um chunk. Usado para rejeitar respostas que claramente não são MPEG-TS
 *  antes de repassá-las ao mpegts.js. */
export function looksLikeTextualErrorBody(data: Uint8Array): boolean {
  if (data.length === 0) return false;
  // Sample the first ~256 bytes.
  const sampleLen = Math.min(256, data.length);
  let ascii = 0;
  let control = 0;
  for (let i = 0; i < sampleLen; i++) {
    const b = data[i];
    const printable = (b >= 32 && b < 127) || b === 9 || b === 10 || b === 13;
    if (printable) ascii++;
    else if (b < 32) control++;
  }
  if (ascii / sampleLen < 0.85) return false;
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(data.subarray(0, sampleLen))
    .trim()
    .toLowerCase();
  if (!head) return false;
  if (head.startsWith("<") /* html/xml */) return true;
  if (head.startsWith("{") || head.startsWith("[")) return true;
  if (/^(unauthorized|forbidden|error|max\s*connections|blocked|banned|invalid)/i.test(head)) {
    return true;
  }
  // Se é praticamente só texto e não parece TS, tratamos como body de erro.
  return control === 0 && ascii > 32 && !head.includes("\u0000");
}

/** Cabeçalhos a NÃO reencaminhar para o navegador em uma resposta de relay
 *  Live MPEG-TS. Usar em teste unitário para garantir que nenhum deles vaze. */
export const FORBIDDEN_RESPONSE_HEADERS = [
  "content-length",
  "content-range",
  "accept-ranges",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
] as const;

/** Sanitiza um Content-Type para exibição em diagnóstico: remove parâmetros,
 *  caracteres fora do padrão MIME e limita o tamanho. */
export function sanitizeContentType(ct: string | null | undefined): string {
  if (!ct) return "";
  return ct
    .split(";")[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/+.-]/g, "")
    .slice(0, 60);
}

/** Lê o primeiro chunk de um reader com timeout real (Promise.race).
 *  Nunca pendura além de `timeoutMs` (spec V5 §3). */
export async function readFirstChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<{ chunk: Uint8Array | null; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<{ chunk: null; timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ chunk: null, timedOut: true }), timeoutMs);
  });
  try {
    const readPromise = reader.read().then((r) => ({
      chunk: (r.done ? null : (r.value ?? null)) as Uint8Array | null,
      timedOut: false as const,
    }));
    const winner = await Promise.race([readPromise, timeoutPromise]);
    return winner;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Acumula bytes a partir do primeiro chunk até `minBytes` (para classificar
 *  com segurança), respeitando o teto `maxBytes` (64 KB no diagnóstico) e um
 *  orçamento de tempo extra. O resultado NUNCA excede `maxBytes`. */
export async function collectUpToLimit(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  firstChunk: Uint8Array,
  opts: { maxBytes: number; minBytes: number; extraTimeMs: number },
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [firstChunk];
  let total = firstChunk.byteLength;
  const deadline = Date.now() + Math.max(0, opts.extraTimeMs);
  while (total < opts.minBytes && total < opts.maxBytes && Date.now() < deadline) {
    const r = await readFirstChunkWithTimeout(reader, Math.max(50, deadline - Date.now()));
    if (r.timedOut || !r.chunk || r.chunk.byteLength === 0) break;
    chunks.push(r.chunk);
    total += r.chunk.byteLength;
  }
  const cap = Math.min(total, opts.maxBytes);
  const out = new Uint8Array(cap);
  let off = 0;
  for (const c of chunks) {
    if (off >= cap) break;
    const slice = c.subarray(0, Math.min(c.byteLength, cap - off));
    out.set(slice, off);
    off += slice.byteLength;
  }
  return out;
}

/** Corpo JSON sanitizado do /api/live-diagnose (spec V5 §2). */
export type LiveDiagnoseBody = {
  ok: boolean;
  errorCode?: string;
  upstreamStatus?: number;
  upstreamContentType?: string;
  firstByteReceived: boolean;
  firstByteMs?: number;
  firstChunkBytes?: number;
  mpegTsSyncFound?: boolean;
  mpegTsSyncOffset?: number;
  bodyKind?: LiveBodyKind;
  elapsedMs?: number;
  // V8 §1/§2 — classificação sanitizada de HTTP 403 (nunca inclui corpo/URL).
  upstreamErrorClass?: Upstream403Class | "NONE";
  upstreamBodyLength?: number;
  responseServer?: string;
  responseCfRay?: string;
  responseVia?: string;
  responseRetryAfter?: string;
  responseLocationHost?: string;
};

/** Constrói o corpo do diagnóstico por WHITELIST estrita: apenas números,
 *  booleans e enums sanitizados. Nunca inclui URL, usuário, senha, token,
 *  query string, corpo binário ou amostra textual. */
export function buildLiveDiagnoseBody(input: LiveDiagnoseBody): LiveDiagnoseBody {
  const out: LiveDiagnoseBody = {
    ok: input.ok === true,
    firstByteReceived: input.firstByteReceived === true,
  };
  if (input.errorCode) {
    out.errorCode = String(input.errorCode).replace(/[^A-Z0-9_]/gi, "").slice(0, 60);
  }
  if (typeof input.upstreamStatus === "number" && Number.isFinite(input.upstreamStatus)) {
    out.upstreamStatus = Math.trunc(input.upstreamStatus);
  }
  const ct = sanitizeContentType(input.upstreamContentType);
  if (ct) out.upstreamContentType = ct;
  if (typeof input.firstByteMs === "number" && Number.isFinite(input.firstByteMs)) {
    out.firstByteMs = Math.max(0, Math.round(input.firstByteMs));
  }
  if (typeof input.firstChunkBytes === "number" && Number.isFinite(input.firstChunkBytes)) {
    out.firstChunkBytes = Math.max(0, Math.trunc(input.firstChunkBytes));
  }
  if (typeof input.mpegTsSyncFound === "boolean") out.mpegTsSyncFound = input.mpegTsSyncFound;
  if (typeof input.mpegTsSyncOffset === "number" && Number.isFinite(input.mpegTsSyncOffset)) {
    out.mpegTsSyncOffset = Math.trunc(input.mpegTsSyncOffset);
  }
  if (input.bodyKind) out.bodyKind = input.bodyKind;
  if (typeof input.elapsedMs === "number" && Number.isFinite(input.elapsedMs)) {
    out.elapsedMs = Math.max(0, Math.round(input.elapsedMs));
  }
  if (input.upstreamErrorClass) out.upstreamErrorClass = input.upstreamErrorClass;
  if (typeof input.upstreamBodyLength === "number" && Number.isFinite(input.upstreamBodyLength)) {
    out.upstreamBodyLength = Math.max(0, Math.trunc(input.upstreamBodyLength));
  }
  if (input.responseServer) out.responseServer = String(input.responseServer).slice(0, 80);
  if (input.responseCfRay) out.responseCfRay = String(input.responseCfRay).slice(0, 80);
  if (input.responseVia) out.responseVia = String(input.responseVia).slice(0, 120);
  if (input.responseRetryAfter) out.responseRetryAfter = String(input.responseRetryAfter).slice(0, 40);
  if (input.responseLocationHost) out.responseLocationHost = String(input.responseLocationHost).slice(0, 120);
  return out;
}

// ---------------------------------------------------------------------------
// V8 §1 — Classificador sanitizado de HTTP 403 do upstream.
// - Lê no máximo 512 bytes de um corpo TEXTUAL exclusivamente para diagnóstico.
// - Nunca devolve, loga ou expõe o texto original.
// - Casa termos conhecidos case-insensitive e devolve apenas o rótulo.
// ---------------------------------------------------------------------------
export type Upstream403Class =
  | "CONNECTION_LIMIT"
  | "ACCESS_DENIED"
  | "IP_BLOCKED_OR_DATACENTER"
  | "AUTH_REJECTED"
  | "GEO_BLOCKED"
  | "RATE_LIMITED"
  | "WAF_CHALLENGE"
  | "UNKNOWN_403";

/** Limite duro de leitura (bytes) de corpo textual em respostas 4xx do upstream
 *  usadas apenas para classificar o erro. Spec V8 §1. */
export const UPSTREAM_ERROR_BODY_MAX_BYTES = 512;

/** Classifica um trecho textual (já limitado a ~512 bytes) de uma resposta 403
 *  em uma categoria conhecida. Nunca retorna nem loga o texto original. */
export function classify403Body(sample: string): Upstream403Class {
  const s = sample.toLowerCase();
  if (/(connection\s*limit|maximum\s*connections?|too\s*many\s*connections?|max_?connections?)/.test(s)) {
    return "CONNECTION_LIMIT";
  }
  if (/(rate[-\s]?limit|too\s*many\s*requests|slow\s*down)/.test(s)) return "RATE_LIMITED";
  if (/(captcha|attention\s*required|cloudflare|cf-?ray|sucuri|challenge|managed\s*challenge)/.test(s)) {
    return "WAF_CHALLENGE";
  }
  if (/(geo[-\s]?block|not\s*available\s*in\s*your\s*country|region\s*not\s*allowed|country|region)/.test(s)) {
    return "GEO_BLOCKED";
  }
  if (/(invalid\s*credentials|unauthorized|authentication\s*failed|bad\s*credentials|token\s*invalid)/.test(s)) {
    return "AUTH_REJECTED";
  }
  if (/(datacenter|data\s*center|hosting\s*provider|proxy\s*detected|vpn\s*detected|ip\s*blocked|blocked\s*ip)/.test(s)) {
    return "IP_BLOCKED_OR_DATACENTER";
  }
  if (/(access\s*denied|forbidden|blocked|banned|not\s*allowed)/.test(s)) return "ACCESS_DENIED";
  return "UNKNOWN_403";
}

/** Lê no máximo `UPSTREAM_ERROR_BODY_MAX_BYTES` bytes do reader e devolve a
 *  string decodificada em UTF-8 (best-effort). Cancela o reader ao final. */
export async function readUpstreamErrorSample(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ text: string; byteLength: number }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const cap = UPSTREAM_ERROR_BODY_MAX_BYTES;
  try {
    while (total < cap) {
      const r = await readFirstChunkWithTimeout(reader, 800);
      if (r.timedOut || !r.chunk || r.chunk.byteLength === 0) break;
      const remaining = cap - total;
      const slice = r.chunk.byteLength > remaining ? r.chunk.subarray(0, remaining) : r.chunk;
      chunks.push(slice);
      total += slice.byteLength;
    }
  } finally {
    try { await reader.cancel("error-sample-complete"); } catch { /* noop */ }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return { text, byteLength: total };
}

/** V8 §2 — Extrai apenas o subconjunto de headers de resposta seguros para
 *  diagnóstico. Nunca inclui set-cookie, authorization, URL, query string. */
export type SafeResponseHeaders = {
  server?: string;
  date?: string;
  retryAfter?: string;
  wwwAuthenticate?: string;
  cfRay?: string;
  cfCacheStatus?: string;
  xCache?: string;
  via?: string;
  xSucuriId?: string;
  xSucuriBlock?: string;
  locationHost?: string;
  locationPath?: string;
  contentType?: string;
};

export function pickSafeResponseHeaders(h: Headers): SafeResponseHeaders {
  const out: SafeResponseHeaders = {};
  const g = (k: string) => (h.get(k) ?? "").toString().slice(0, 200);
  const set = (k: keyof SafeResponseHeaders, v: string) => {
    if (v) (out as Record<string, string>)[k as string] = v;
  };
  set("server", g("server"));
  set("date", g("date"));
  set("retryAfter", g("retry-after"));
  set("wwwAuthenticate", g("www-authenticate").split(",")[0]);
  set("cfRay", g("cf-ray"));
  set("cfCacheStatus", g("cf-cache-status"));
  set("xCache", g("x-cache"));
  set("via", g("via"));
  set("xSucuriId", g("x-sucuri-id"));
  set("xSucuriBlock", g("x-sucuri-block"));
  set("contentType", sanitizeContentType(h.get("content-type")));
  const loc = h.get("location");
  if (loc) {
    try {
      const u = new URL(loc);
      set("locationHost", u.host);
      set("locationPath", u.pathname);
    } catch {
      const q = loc.indexOf("?");
      set("locationPath", (q >= 0 ? loc.slice(0, q) : loc).slice(0, 200));
    }
  }
  return out;
}

/** V8 §4 — Construtor único e padronizado dos headers enviados ao provedor.
 *  Preview e publicado DEVEM usar exatamente esta função. Sem Origin/Referer/
 *  cookies/X-Forwarded-For — evita disparar WAF diferente entre ambientes. */
export function buildUpstreamRequestHeaders(userAgent: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    Accept: "*/*",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Accept-Encoding": "identity",
  };
}

