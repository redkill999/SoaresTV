import { useSyncExternalStore, useCallback } from "react";
import { store, type FavItem, type HistItem } from "@/lib/storage";

const EMPTY_FAVS: FavItem[] = [];
const EMPTY_HIST: HistItem[] = [];

export function useFavorites(): FavItem[] {
  return useSyncExternalStore(
    (cb) => store.subscribeFavs(cb),
    () => store.getFavs(),
    () => EMPTY_FAVS,
  );
}

/**
 * FIX (audit Android TV): retorna boolean derivado direto do snapshot do
 * storage. useSyncExternalStore compara o snapshot com Object.is — assim,
 * mesmo que o array de favoritos mude, este hook só dispara re-render
 * quando a pertinência DESTE item específico muda. Antes, cada tile
 * subscrevia o array inteiro e re-renderizava em qualquer toggle.
 */
export function useIsFavorite(type: FavItem["type"], id: string | number): boolean {
  const idStr = String(id);
  const getSnapshot = useCallback(
    () => store.isFav(type, idStr),
    [type, idStr],
  );
  const subscribe = useCallback((cb: () => void) => store.subscribeFavs(cb), []);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function useHistory(): HistItem[] {
  return useSyncExternalStore(
    (cb) => store.subscribeHistory(cb),
    () => store.getHistory(),
    () => EMPTY_HIST,
  );
}
