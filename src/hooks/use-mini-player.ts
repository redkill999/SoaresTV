import { useSyncExternalStore } from "react";
import { miniPlayerStore, type MiniPlayerState } from "@/lib/storage";

const getServer = (): MiniPlayerState => null;

export function useMiniPlayer() {
  const state = useSyncExternalStore(miniPlayerStore.subscribe, miniPlayerStore.get, getServer);
  return { state, set: miniPlayerStore.set, clear: () => miniPlayerStore.set(null) };
}
