// Guarda de SSRF para todos os fetches server-side que aceitam URL controlada
// pelo cliente (proxy de stream + funções Xtream/M3U). Em Workers/Edge o
// runtime não expõe DNS direto, então bloqueamos por hostname literal e por
// IP literal (IPv4/IPv6) — cobre 99% dos ataques práticos (metadata endpoint,
// loopback, faixas privadas). Também validamos cada hop de redirect.
//
// EXCEÇÃO LIVE/IPTV: mídia ao vivo (/live/ no path, segmentos .ts) NUNCA é
// bloqueada — painéis IPTV redirecionam streams para IPs de balanceamento em
// faixas CGNAT/privadas, e o bloqueio cortava o stream no meio (ExoPlayer
// recebia stream vazio/interrompido). O guard continua ativo para APIs,
// metadata e endpoints não-stream.

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

// Hosts IPTV explicitamente liberados — NUNCA bloquear (nem seus subdomínios).
const IPTV_ALLOWED_HOSTS = new Set(["multopt100.top"]);

function isIptvAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (IPTV_ALLOWED_HOSTS.has(h)) return true;
  for (const allowed of IPTV_ALLOWED_HOSTS) {
    if (h.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

/**
 * true se a URL é mídia LIVE de IPTV: path contendo /live/ (Xtream live,
 * inclusive .m3u8 de live) ou segmento MPEG-TS (.ts). Essas URLs passam
 * DIRETO, sem filtro SSRF — fluxo obrigatório: Xtream live URL → ExoPlayer.
 */
export function isLiveMediaUrl(u: URL): boolean {
  const p = u.pathname.toLowerCase();
  return p.includes("/live/") || p.endsWith(".ts");
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local")) return true;
  return false;
}

function parseIPv4(hostname: string): number[] | null {
  // Aceita 0.0.0.0 até 255.255.255.255 (não tenta decimal/octal como cURL).
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((p) => p < 0 || p > 255)) return null;
  return parts;
}

function isBlockedIPv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 0) return true;                     // 0.0.0.0/8
  if (a === 10) return true;                    // 10.0.0.0/8
  if (a === 127) return true;                   // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;      // 169.254.0.0/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;      // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a >= 224) return true;                    // multicast/reserved
  return false;
}

function stripIPv6Brackets(h: string): string {
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

function isBlockedIPv6(hostname: string): boolean {
  const raw = stripIPv6Brackets(hostname).toLowerCase();
  if (!raw.includes(":")) return false;
  if (raw === "::" || raw === "::1") return true;
  // IPv4-mapped: ::ffff:a.b.c.d — reaproveita a validação IPv4.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(raw);
  if (mapped) {
    const parts = parseIPv4(mapped[1]);
    if (parts && isBlockedIPv4(parts)) return true;
  }
  // fe80::/10 link-local (inclui fe80..febf)
  if (/^fe[89ab][0-9a-f]?:/i.test(raw)) return true;
  // fc00::/7 unique-local
  if (/^f[cd][0-9a-f]{2}:/i.test(raw)) return true;
  return false;
}

/**
 * Lança se a URL fornecida aponta para um destino inseguro (SSRF).
 * Reutilizar em qualquer fetch server-side com host controlado pelo cliente.
 *
 * BYPASS OBRIGATÓRIO: mídia LIVE IPTV (/live/ ou .ts) e hosts IPTV liberados
 * nunca são bloqueados — o guard só atua em API interna, metadata e
 * endpoints não-stream.
 */
export function assertSafeUpstreamUrl(input: string | URL): URL {
  let u: URL;
  try {
    u = typeof input === "string" ? new URL(input) : input;
  } catch {
    throw new Error("invalid url");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
  const host = u.hostname;
  if (!host) throw new Error("empty host");

  // EXCEÇÃO LIVE: nunca bloquear stream ao vivo nem hosts IPTV liberados.
  if (isLiveMediaUrl(u) || isIptvAllowedHost(host)) {
    return u;
  }

  if (isBlockedHostname(host)) throw new Error("blocked host");
  const v4 = parseIPv4(host);
  if (v4 && isBlockedIPv4(v4)) throw new Error("blocked ip");
  if (isBlockedIPv6(host)) throw new Error("blocked ip");
  return u;
}

/** true se a URL passa na validação anti-SSRF. */
export function isSafeUpstreamUrl(input: string | URL): boolean {
  try { assertSafeUpstreamUrl(input); return true; } catch { return false; }
}

/**
 * fetch com validação anti-SSRF em cada hop de redirect. Substitui
 * `redirect: "follow"` — cada Location é revalidada antes de seguir.
 */
export async function safeFetch(
  input: string | URL,
  init: RequestInit = {},
  opts: { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 5;
  let current = assertSafeUpstreamUrl(input).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      try { await res.body?.cancel(); } catch { /* noop */ }
      const next = new URL(loc, current);
      assertSafeUpstreamUrl(next);
      current = next.toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}
