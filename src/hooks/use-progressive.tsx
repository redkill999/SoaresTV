import { useEffect, useRef, useState } from "react";

/**
 * Renderiza listas grandes em chunks: começa com `initial` itens e cresce
 * `step` itens cada vez que o sentinel entra na viewport.
 * Evita pintar 5k+ tiles de uma vez (causa principal de lentidão ao abrir
 * Filmes/Séries em navegador desktop e em Android TV).
 */
export function useProgressive<T>(items: T[], initial = 240, step = 240) {
  const [count, setCount] = useState(initial);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Reset quando a lista muda (categoria/busca/sort).
  useEffect(() => {
    setCount(initial);
  }, [items, initial]);

  useEffect(() => {
    if (count >= items.length) return;
    const node = sentinelRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setCount(items.length);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setCount((c) => Math.min(items.length, c + step));
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [count, items.length, step]);

  return {
    visible: count < items.length ? items.slice(0, count) : items,
    sentinelRef,
    hasMore: count < items.length,
  };
}
