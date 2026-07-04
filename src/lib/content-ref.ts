// ============================================================================
//  ContentReference + ProviderAccount — modelo de identidade estável
// ----------------------------------------------------------------------------
//  PROBLEMA que este módulo resolve:
//  Hoje favoritos e histórico usam apenas { type, id }. O `id` é o `stream_id`
//  do Xtream ou `m3u-N` do parser M3U — nenhum dos dois é único entre
//  provedores. Trocar de painel/lista pode fazer um favorito antigo abrir um
//  canal totalmente diferente com o mesmo número.
//
//  Este módulo define:
//   1. `ProviderAccount` — identificação estável de conta (Xtream ou M3U).
//   2. `ContentReference` — referência completa a um conteúdo (com providerId).
//   3. `stableId(...)` — hash determinístico. Mesmo conteúdo do mesmo provedor
//      → mesmo id sempre. Conteúdo de provedores diferentes → ids diferentes.
//
//  MIGRAÇÃO é implementada em `storage.ts` — este módulo só define contratos.
// ============================================================================

export type ContentType =
  | "live"
  | "movie"
  | "series"
  | "episode"
  | "radio"
  | "catchup";

/** Identidade estável de um provedor (Xtream server ou lista M3U). */
export interface ProviderAccount {
  /** ID interno estável (hash do server+user OU url). */
  id: string;
  /** Nome amigável (mostrado ao usuário). */
  name: string;
  type: "xtream" | "m3u";
  /** Server Xtream ou base URL da M3U (sem credenciais). */
  server: string;
  /** Username Xtream ou M3U (apenas identificação — senha NUNCA vai aqui). */
  username?: string;
}

/** Referência completa a um item de conteúdo. */
export interface ContentReference {
  providerId: string;
  contentType: ContentType;
  /** ID nativo do provedor (stream_id Xtream, index M3U, etc.). */
  contentId: string;
  /** ID estável derivado — usar como chave em favs/hist. */
  stableId: string;
  /** Nome exibido. */
  name: string;
  logo?: string;
  /** URL de playback quando o provedor não segue padrão Xtream. */
  playbackUrl?: string;
  containerExtension?: string;
  tvgId?: string;
  categoryId?: string;
  seriesId?: string;
  seasonNumber?: number;
  episodeId?: string;
}

// ----------------------------------------------------------------------------
//  Hash determinístico — usado para providerId e stableId
// ----------------------------------------------------------------------------

/**
 * Hash não-criptográfico (FNV-1a 32-bit + base36).
 * Não é seguro para segredos — é só para gerar IDs curtos e estáveis.
 * Mesma entrada → mesma saída sempre, entre sessões e dispositivos.
 */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Distribui mais bits mesclando com hash de tamanho.
  h ^= input.length;
  h = Math.imul(h, 0x01000193);
  return (h >>> 0).toString(36);
}

/** Normaliza host/URL para hash estável (lowercase, sem porta default, sem barra final). */
function normalizeForHash(s: string): string {
  return s.trim().toLowerCase().replace(/\/+$/, "").replace(/:80$|:443$/, "");
}

// ----------------------------------------------------------------------------
//  Provider ID derivation
// ----------------------------------------------------------------------------

/** Gera ID estável para uma conta Xtream a partir de server+username. */
export function providerIdFromXtream(server: string, username: string): string {
  const key = `xtream|${normalizeForHash(server)}|${username.trim().toLowerCase()}`;
  return `x${fnv1a(key)}`;
}

/** Gera ID estável para uma lista M3U a partir de URL+username (se houver). */
export function providerIdFromM3U(url: string, username?: string): string {
  const key = `m3u|${normalizeForHash(url)}|${(username || "").trim().toLowerCase()}`;
  return `m${fnv1a(key)}`;
}

// ----------------------------------------------------------------------------
//  Stable content ID derivation
// ----------------------------------------------------------------------------

interface StableIdInput {
  providerId: string;
  contentType: ContentType;
  /** Prefira tvg-id > stream_id > URL normalizada > name. Qualquer coisa
   *  determinística que identifique o conteúdo dentro do provedor. */
  contentId: string | number;
  /** Season/episode para séries — evita colisão entre EP1 da S1 e S2. */
  seasonNumber?: number;
  episodeId?: string | number;
}

/**
 * Gera stableId determinístico para um ContentReference.
 * IMPORTANTE: só depende dos inputs — nunca de Date.now() ou random.
 * Formato: `<providerId>:<type>:<hash>` — providerId visível ajuda debug.
 */
export function stableIdOf(input: StableIdInput): string {
  const parts = [
    input.providerId,
    input.contentType,
    String(input.contentId).trim().toLowerCase(),
    input.seasonNumber !== undefined ? `s${input.seasonNumber}` : "",
    input.episodeId !== undefined ? `e${String(input.episodeId).toLowerCase()}` : "",
  ].join("|");
  return `${input.providerId}:${input.contentType}:${fnv1a(parts)}`;
}

// ----------------------------------------------------------------------------
//  Legacy-key resolution (para migração)
// ----------------------------------------------------------------------------

/**
 * Item legado tem `{ type, id }` sem providerId. Para migrar, precisamos
 * inferir a qual provedor pertence usando o provedor ATIVO no momento da
 * migração. Não é perfeito — se o usuário tinha vários provedores, o item
 * pode ser atribuído ao errado. Mas é o melhor que dá sem informação
 * adicional, e é MELHOR que colisão silenciosa (o pior caso é o favorito
 * "não abrir" quando o provedor mudar; o item continua no localStorage e o
 * usuário pode remover manualmente).
 */
export function stableIdFromLegacy(
  providerId: string,
  legacyType: "live" | "movie" | "series",
  legacyId: string,
): string {
  return stableIdOf({
    providerId,
    contentType: legacyType,
    contentId: legacyId,
  });
}
