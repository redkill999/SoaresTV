// Integração opcional com relay Live EXTERNO dedicado (spec V-final §4/§10).
// INERTE por padrão: só ativa quando VITE_LIVE_RELAY_BASE_URL estiver definida
// no build. Aplicada exclusivamente aos hosts com WebLiveProviderOverride
// (LIVE + Web Desktop). APK e Android TV nunca usam este caminho — o override
// é nulo fora do navegador desktop.
//
// Contrato:
//   1. o frontend extrai da própria URL do provedor (workingSrc) host, porta,
//      protocolo, usuário, senha e streamId — informação que já está em
//      memória do player;
//   2. envia esses campos para /api/live-relay-token; o backend criptografa
//      com AES-256-GCM (LIVE_RELAY_ENCRYPTION_KEY) e devolve um token opaco;
//   3. o token é usado em `${base}/live/${token}` — sem query string, sem
//      credenciais visíveis ao navegador.

export const EXTERNAL_LIVE_RELAY_SENTINEL = "external-relay://live";

export function externalLiveRelayBase(): string | null {
  try {
    const v = (import.meta.env as Record<string, string | undefined>).VITE_LIVE_RELAY_BASE_URL;
    if (!v || typeof v !== "string") return null;
    const trimmed = v.trim().replace(/\/+$/, "");
    return trimmed || null;
  } catch {
    return null;
  }
}

interface UpstreamStreamParts {
  host: string;
  port: number | null;
  protocol: "http" | "https";
  username: string;
  password: string;
  streamId: string;
}

/** Extrai host/port/protocol/username/password/streamId de uma URL Xtream do
 *  formato `<proto>://<host>[:port]/live/<user>/<pass>/<streamId>.ts`.
 *  Retorna null quando qualquer parte obrigatória estiver ausente. */
export function parseXtreamLiveUrl(rawUrl: string): UpstreamStreamParts | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    // ["live", user, pass, "<id>.ts"] OR ["live", user, pass, "<id>"]
    if (parts.length < 4 || parts[0] !== "live") return null;
    const username = decodeURIComponent(parts[1] ?? "");
    const password = decodeURIComponent(parts[2] ?? "");
    const idPart = parts[parts.length - 1];
    const streamId = idPart.replace(/\.[a-z0-9]+$/i, "");
    if (!username || !password || !/^\d{1,12}$/.test(streamId)) return null;
    return {
      host: u.hostname.toLowerCase(),
      port: u.port ? Number.parseInt(u.port, 10) : null,
      protocol: u.protocol === "http:" ? "http" : "https",
      username,
      password,
      streamId,
    };
  } catch {
    return null;
  }
}

/** Solicita ao backend um token AES-256-GCM (60 s) e monta a URL do relay
 *  externo: `${base}/live/<token>`. Nunca coloca usuário, senha ou URL do
 *  provedor na query pública. Retorna null quando o recurso não está
 *  configurado, quando a URL não pode ser desmontada ou quando o backend
 *  recusa (host fora da allowlist, criptografia indisponível, etc.). */
export async function mintExternalLiveRelayUrl(workingSrc: string): Promise<string | null> {
  const base = externalLiveRelayBase();
  if (!base) return null;
  const parts = parseXtreamLiveUrl(workingSrc);
  if (!parts) return null;
  try {
    const res = await fetch("/api/live-relay-token", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: parts.host,
        port: parts.port,
        protocol: parts.protocol,
        username: parts.username,
        password: parts.password,
        streamId: parts.streamId,
        kind: "live",
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { ok?: boolean; token?: string } | null;
    if (!j?.ok || !j.token) return null;
    return `${base}/live/${encodeURIComponent(j.token)}`;
  } catch {
    return null;
  }
}
