import { useSyncExternalStore } from "react";
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

export function useIsFavorite(type: FavItem["type"], id: string | number): boolean {
  const idStr = String(id);
  const favs = useFavorites();
  return favs.some((f) => f.type === type && f.id === idStr);
}

export function useHistory(): HistItem[] {
  return useSyncExternalStore(
    (cb) => store.subscribeHistory(cb),
    () => store.getHistory(),
    () => EMPTY_HIST,
  );
}
