// Integração opcional com relay Live EXTERNO dedicado (spec V5 §10/§11).
// INERTE por padrão: só ativa quando VITE_LIVE_RELAY_BASE_URL estiver definida
// no build. Aplicada exclusivamente aos hosts com WebLiveProviderOverride
// (LIVE + Web Desktop). APK e Android TV nunca usam este caminho — o override
// é nulo fora do navegador desktop.

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

/** Solicita ao backend um token curto assinado (60 s) e monta a URL do relay
 *  externo: `${base}/live?token=...`. Nunca coloca usuário, senha ou URL do
 *  provedor na query pública. Retorna null quando o recurso não está
 *  configurado (o player avança para o próximo candidato). */
export async function mintExternalLiveRelayUrl(
  host: string,
  streamId: string,
): Promise<string | null> {
  const base = externalLiveRelayBase();
  if (!base || !host) return null;
  try {
    const res = await fetch("/api/live-token", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, streamId, kind: "live" }),
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as { ok?: boolean; token?: string } | null;
    if (!j?.ok || !j.token) return null;
    return `${base}/live?token=${encodeURIComponent(j.token)}`;
  } catch {
    return null;
  }
}
