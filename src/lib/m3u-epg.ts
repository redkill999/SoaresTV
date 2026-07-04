/**
 * Serviço de EPG para listas M3U puras.
 *
 * Junta `M3UParseResult.epgUrls` (do parser em `xtream.ts`) com o parser
 * XMLTV (`xmltv.ts`), baixa os XMLs (com suporte a `.gz` via
 * `DecompressionStream`) e devolve um `XmltvIndex` cacheado em memória.
 *
 * Isolado: NÃO altera o fluxo Xtream/`get_simple_data_table` já usado em
 * `guide.tsx`. Consumidores futuros (guide para provider M3U, MiniLivePlayer,
 * etc.) chamam `getActiveXmltvIndex()` sob demanda.
 */

import { parseXmltv, type XmltvIndex, lookupNowProgramme } from "@/lib/xmltv";

type CacheEntry = {
  key: string;
  index: XmltvIndex;
  fetchedAt: number;
};

const TTL_MS = 6 * 60 * 60 * 1000; // 6h
let active: CacheEntry | null = null;
let inflight: Promise<XmltvIndex | null> | null = null;

function cacheKey(urls: string[]): string {
  return urls.slice().sort().join("|");
}

function looksGzip(url: string, contentType: string | null): boolean {
  if (contentType && /gzip|application\/x-gzip/i.test(contentType)) return true;
  const u = url.toLowerCase().split("?")[0];
  return u.endsWith(".gz") || u.endsWith(".xml.gz");
}

async function decodeMaybeGzip(res: Response, url: string): Promise<string> {
  const ct = res.headers.get("content-type");
  if (!looksGzip(url, ct)) return await res.text();
  // Usa DecompressionStream quando disponível (browser moderno + Workers).
  const DS = (globalThis as unknown as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS || !res.body) {
    // Sem DecompressionStream: devolve texto bruto (parser vai encontrar 0 canais
    // e o consumidor decide). Não estouramos exceção — evita quebrar o app.
    return await res.text();
  }
  const stream = res.body.pipeThrough(new DS("gzip"));
  return await new Response(stream).text();
}

async function fetchOne(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, { signal, redirect: "follow" });
    if (!res.ok) return null;
    return await decodeMaybeGzip(res, url);
  } catch {
    return null;
  }
}

/**
 * Baixa e faz merge de vários XMLTVs. Se todos falharem, retorna null.
 * Merge = concatena programas por channelId; primeira display-name vence.
 */
export async function loadXmltvFromUrls(
  urls: string[],
  opts?: { signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<XmltvIndex | null> {
  const clean = urls.filter((u) => typeof u === "string" && /^https?:/i.test(u));
  if (!clean.length) return null;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const texts = await Promise.all(clean.map((u) => fetchOne(u, fetchImpl, opts?.signal)));
  const cancel = { aborted: false };
  opts?.signal?.addEventListener("abort", () => { cancel.aborted = true; });

  const merged: XmltvIndex = {
    byChannel: new Map(),
    channelByDisplay: new Map(),
    totalProgrammes: 0,
    truncated: false,
  };
  let any = false;
  for (const text of texts) {
    if (!text) continue;
    if (cancel.aborted) break;
    const idx = parseXmltv(text, { signal: cancel });
    any = true;
    merged.truncated = merged.truncated || idx.truncated;
    merged.totalProgrammes += idx.totalProgrammes;
    for (const [id, list] of idx.byChannel) {
      const existing = merged.byChannel.get(id);
      if (existing) existing.push(...list);
      else merged.byChannel.set(id, list);
    }
    for (const [name, id] of idx.channelByDisplay) {
      if (!merged.channelByDisplay.has(name)) merged.channelByDisplay.set(name, id);
    }
  }
  if (!any) return null;
  // reordena após merge
  for (const list of merged.byChannel.values()) list.sort((a, b) => a.start - b.start);
  return merged;
}

/**
 * Retorna o índice ativo, buscando/parsing se necessário.
 * Dedupa requests concorrentes; respeita TTL de 6h.
 */
export async function getActiveXmltvIndex(
  urls: string[],
  opts?: { force?: boolean; signal?: AbortSignal },
): Promise<XmltvIndex | null> {
  const key = cacheKey(urls);
  if (!opts?.force && active && active.key === key && Date.now() - active.fetchedAt < TTL_MS) {
    return active.index;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const idx = await loadXmltvFromUrls(urls, { signal: opts?.signal });
      if (idx) active = { key, index: idx, fetchedAt: Date.now() };
      return idx;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function clearActiveXmltvIndex(): void {
  active = null;
}

export { lookupNowProgramme };
