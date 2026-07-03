// Helpers de Controle Parental — cruzam o cache local de listas (Xtream)
// com `parental.lockedCategories` para saber, sem re-fetch, quais IDs de
// canais/filmes/séries pertencem a categorias bloqueadas.

import { store } from "./storage";
import { loadPersisted } from "./query-persist";
import type { LiveStream, VodStream, Series } from "./xtream";

export type ParentalKind = "live" | "movie" | "series";

function accountKeys(): string[] {
  const set = new Set<string>();
  const creds = store.getCreds();
  if (creds) set.add(`${creds.server}|${creds.username}`);
  for (const list of store.getM3U()) {
    try {
      const u = new URL(list.url);
      const username = u.searchParams.get("username") || list.username;
      if (username) set.add(`${u.origin}|${username}`);
    } catch {
      /* noop */
    }
  }
  return Array.from(set);
}

function suffixFor(kind: ParentalKind): string {
  return kind === "live" ? "live-streams" : kind === "movie" ? "vod-list" : "series-list";
}

/**
 * Set de IDs bloqueados para um tipo — considera o cache persistido de
 * todas as contas conhecidas. Vazio se não há PIN ou nenhuma categoria
 * bloqueada.
 */
export function getLockedIdSet(kind: ParentalKind): Set<string> {
  const out = new Set<string>();
  const p = store.getParental();
  if (!p.pin || !p.lockedCategories.length) return out;
  const locked = new Set(p.lockedCategories.map(String));
  const suffix = suffixFor(kind);
  for (const acct of accountKeys()) {
    const cached = loadPersisted<Array<LiveStream | VodStream | Series>>(
      `${suffix}:${acct}:all`,
    )?.data;
    if (!cached) continue;
    for (const it of cached) {
      const catId = String((it as { category_id?: string | number }).category_id ?? "");
      if (!locked.has(catId)) continue;
      if (kind === "series") {
        out.add(String((it as Series).series_id));
      } else if (kind === "movie") {
        const m = it as VodStream;
        const ext = m.container_extension || "mp4";
        out.add(`${m.stream_id}.${ext}`);
        out.add(String(m.stream_id));
      } else {
        out.add(String((it as LiveStream).stream_id));
      }
    }
  }
  return out;
}

/** Retorna true se o item pertence a alguma categoria bloqueada. */
export function isItemLocked(kind: ParentalKind, id: string): boolean {
  return getLockedIdSet(kind).has(String(id));
}

/** Retorna a category_id conhecida de um item, se estiver em cache. */
export function findCategoryIdFor(kind: ParentalKind, id: string): string | null {
  const suffix = suffixFor(kind);
  for (const acct of accountKeys()) {
    const cached = loadPersisted<Array<LiveStream | VodStream | Series>>(
      `${suffix}:${acct}:all`,
    )?.data;
    if (!cached) continue;
    for (const it of cached) {
      let itemId: string;
      if (kind === "series") itemId = String((it as Series).series_id);
      else if (kind === "movie") {
        const m = it as VodStream;
        itemId = String(m.stream_id);
        const withExt = `${m.stream_id}.${m.container_extension || "mp4"}`;
        if (String(id) !== itemId && String(id) !== withExt) continue;
      } else itemId = String((it as LiveStream).stream_id);
      if (String(id) === itemId) {
        return String((it as { category_id?: string | number }).category_id ?? "");
      }
    }
  }
  return null;
}
