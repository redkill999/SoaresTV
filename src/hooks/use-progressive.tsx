import { useEffect, useMemo, useRef, useState } from "react";
import { getDeviceProfile } from "@/lib/device-profile";

/**
 * Retorna tamanhos de chunk apropriados ao dispositivo. Renderizar 240
 * cards de uma vez no APK celular / Android TV causava ANR ("SoaresTV
 * não está respondendo"), então cada perfil tem um teto próprio.
 */
export function getDeviceChunkSize(): { initial: number; step: number } {
  if (typeof window === "undefined") return { initial: 60, step: 40 };
  try {
    const p = getDeviceProfile();
    if (p.isTv) return { initial: 36, step: 24 };
    if (p.isMobile) return { initial: 24, step: 18 };
    if (p.isTablet) return { initial: 30, step: 20 };
    return { initial: 80, step: 40 }; // desktop
  } catch {
    return { initial: 60, step: 40 };
  }
}

/**
 * Renderiza listas grandes em chunks: começa com `initial` itens e cresce
 * `step` itens cada vez que o sentinel entra na viewport.
 * Se `initial`/`step` não forem passados, usa perfil do dispositivo.
 */
export function useProgressive<T>(items: T[], initial?: number, step?: number) {
  const chunks = useMemo(() => {
    const d = getDeviceChunkSize();
    return { initial: initial ?? d.initial, step: step ?? d.step };
  }, [initial, step]);
  const [count, setCount] = useState(chunks.initial);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setCount(chunks.initial);
  }, [items, chunks.initial]);

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
          setCount((c) => Math.min(items.length, c + chunks.step));
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [count, items.length, chunks.step]);

  return {
    visible: count < items.length ? items.slice(0, count) : items,
    sentinelRef,
    hasMore: count < items.length,
  };
}
