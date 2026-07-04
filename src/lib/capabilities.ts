// ============================================================================
//  CapabilityDiscovery — o que a lista atual do usuário realmente oferece?
// ----------------------------------------------------------------------------
//  Antes, /loading exigia que Live + VOD + Séries TODOS funcionassem antes de
//  liberar a Home. Painéis Xtream "só Live" ou "só VOD" ficavam presos em
//  "Esperando..." pra sempre. Isso está corrigido: a Home libera com QUALQUER
//  capacidade disponível; menus indisponíveis viram click-to-explain no
//  home.tsx.
//
//  Este módulo:
//    - define o formato Capabilities;
//    - persiste em localStorage (chave separada, não polui appSettings);
//    - expõe helpers de leitura/escrita e subscribe;
//    - não faz descoberta ativa — quem descobre é /loading (Xtream) e
//      loadM3U (M3U). Este módulo é o CONTRATO de dados.
// ============================================================================

export type CapabilityStatus = "available" | "unavailable" | "unknown";

export type CapabilityKey =
  | "live"
  | "movies"
  | "series"
  | "epg"
  | "radio"
  | "catchup";

export type Capabilities = Record<CapabilityKey, CapabilityStatus> & {
  /** Quando foi feita a última descoberta (ms). */
  discoveredAt: number;
};

const DEFAULT_CAPABILITIES: Capabilities = {
  live: "unknown",
  movies: "unknown",
  series: "unknown",
  epg: "unknown",
  radio: "unknown",
  catchup: "unknown",
  discoveredAt: 0,
};

const K_CAPS = "soarestv:capabilities";

function isBrowser() {
  return typeof window !== "undefined";
}

export function getCapabilities(): Capabilities {
  if (!isBrowser()) return { ...DEFAULT_CAPABILITIES };
  try {
    const raw = localStorage.getItem(K_CAPS);
    if (!raw) return { ...DEFAULT_CAPABILITIES };
    const parsed = JSON.parse(raw) as Partial<Capabilities>;
    return { ...DEFAULT_CAPABILITIES, ...parsed };
  } catch {
    return { ...DEFAULT_CAPABILITIES };
  }
}

export function setCapabilities(patch: Partial<Capabilities>) {
  if (!isBrowser()) return;
  const cur = getCapabilities();
  const next: Capabilities = {
    ...cur,
    ...patch,
    discoveredAt: patch.discoveredAt ?? Date.now(),
  };
  try {
    localStorage.setItem(K_CAPS, JSON.stringify(next));
    // Notifica listeners (StorageEvent não dispara na mesma aba).
    for (const fn of listeners) fn();
  } catch {
    /* quota exceeded — ignorar; capacidades são cache */
  }
}

export function clearCapabilities() {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(K_CAPS);
  } catch { /* noop */ }
  for (const fn of listeners) fn();
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribeCapabilities(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * true se ao menos uma capacidade de conteúdo (live/movies/series/radio)
 * está disponível — critério para liberar a Home.
 * EPG e catchup são secundários (dependem de live).
 */
export function hasAnyContent(caps: Capabilities): boolean {
  return (
    caps.live === "available" ||
    caps.movies === "available" ||
    caps.series === "available" ||
    caps.radio === "available"
  );
}

/** Mensagem curta pra quando o usuário clica num menu indisponível. */
export function capabilityUnavailableReason(k: CapabilityKey): string {
  switch (k) {
    case "live":
      return "Este servidor não oferece canais ao vivo.";
    case "movies":
      return "Este servidor não oferece filmes (VOD).";
    case "series":
      return "Este servidor não oferece séries.";
    case "epg":
      return "Guia (EPG) não disponível para esta lista.";
    case "radio":
      return "Rádio não disponível nesta lista.";
    case "catchup":
      return "Nenhum canal desta lista suporta reprise (catch-up).";
  }
}
