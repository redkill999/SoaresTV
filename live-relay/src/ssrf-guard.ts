// -----------------------------------------------------------------------------
// SSRF guard: only resolve to public IP addresses.
// Called before opening the upstream connection.
// -----------------------------------------------------------------------------
import { promises as dns } from "node:dns";
import net from "node:net";

function isPrivateV4(addr: string): boolean {
  const p = addr.split(".").map((x) => Number.parseInt(x, 10));
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateV6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === "::1" || a === "::") return true;
  if (a.startsWith("fe80:")) return true;
  if (a.startsWith("fc") || a.startsWith("fd")) return true;
  if (a.startsWith("ff")) return true;
  if (a.startsWith("::ffff:")) return isPrivateV4(a.slice(7));
  return false;
}

export async function assertPublicHost(host: string): Promise<void> {
  if (net.isIP(host)) {
    if (net.isIP(host) === 4 && isPrivateV4(host)) throw new Error("PRIVATE_IP");
    if (net.isIP(host) === 6 && isPrivateV6(host)) throw new Error("PRIVATE_IP");
    return;
  }
  const results = await dns.lookup(host, { all: true, verbatim: true });
  if (results.length === 0) throw new Error("DNS_EMPTY");
  for (const r of results) {
    if (r.family === 4 && isPrivateV4(r.address)) throw new Error("PRIVATE_IP");
    if (r.family === 6 && isPrivateV6(r.address)) throw new Error("PRIVATE_IP");
  }
}
