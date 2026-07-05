// STREAMING LAYER (isolada da API layer).
// UI → resolveStreamUrl → ExoPlayer. Sem cache, sem retry, sem transform,
// sem server-guard (server-guard já faz bypass de /live/ e .ts).
//
// Regra única e explícita:
//   1) se o item tem src http(s) real (M3U), usa direto — SEM modificação
//   2) senão, monta a URL Xtream LIVE com as credenciais hidratadas
//   3) senão, erro explícito (nunca placeholder, nunca fallback silencioso)

import type { XtreamCreds } from "@/lib/storage";

export type StreamItem = {
  src?: string | null;
  stream_id?: number | string | null;
};

function normalizeServer(server: string): string {
  return server.replace(/\/+$/, "");
}

export function resolveStreamUrl(
  item: StreamItem,
  creds: XtreamCreds | null | undefined,
): string {
  const src = item?.src;
  if (typeof src === "string" && src.length > 10 && /^https?:\/\//i.test(src)) {
    return src;
  }

  const id = item?.stream_id;
  if (id != null && creds && creds.server && creds.username && creds.password) {
    const url = `${normalizeServer(creds.server)}/live/${creds.username}/${creds.password}/${id}.ts`;
    if (url.includes("***USER***") || url.includes("***PASS***")) {
      throw new Error("Stream inválido: placeholders não substituídos");
    }
    return url;
  }

  throw new Error("Stream inválido: sem src M3U e sem credenciais para montar LIVE");
}

/** Variante segura — retorna "" em vez de lançar. */
export function tryResolveStreamUrl(
  item: StreamItem,
  creds: XtreamCreds | null | undefined,
): string {
  try {
    return resolveStreamUrl(item, creds);
  } catch {
    return "";
  }
}
