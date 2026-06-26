import { useEffect, useSyncExternalStore } from "react";
import { globalSearchStore } from "@/lib/storage";

export function useGlobalSearch() {
  const open = useSyncExternalStore(
    globalSearchStore.subscribe,
    globalSearchStore.get,
    () => false,
  );
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(globalSearchStore.get()) : v;
    globalSearchStore.set(next);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        globalSearchStore.set(!globalSearchStore.get());
      } else if (e.key === "Escape" && globalSearchStore.get()) {
        globalSearchStore.set(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}
