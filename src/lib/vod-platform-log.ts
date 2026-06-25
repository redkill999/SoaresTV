// ============================================================================
// Logs de VOD/LIVE com prefixo por plataforma.
//
// Objetivo: detectar imediatamente regressões cruzadas entre Web e APK.
// Toda mensagem relacionada a reprodução passa por um destes helpers, que
// estampa [VOD WEB] ou [VOD ANDROID] no console. Se um log Web aparecer no
// APK (ou vice-versa) sabemos na hora que houve vazamento de fluxo.
//
// Uso típico:
//   import { vlog } from "@/lib/vod-platform-log";
//   vlog("session start", { url, candidates });
//
// Não substitui logs internos (`plog` de playback-engine, `[LIVE FINAL URL]`,
// etc.) — vive ao lado deles, focado em VOD/streaming end-to-end.
// ============================================================================

import { PLATFORM_ANDROID, PLATFORM_ANDROID_TV, PLATFORM_WEB_DESKTOP, platformLabel } from "@/lib/platform-flags";

type Level = "log" | "warn" | "error" | "info" | "group" | "groupEnd";

function prefix(): string {
  if (PLATFORM_ANDROID_TV) return "[VOD ANDROID-TV]";
  if (PLATFORM_ANDROID) return "[VOD ANDROID]";
  if (PLATFORM_WEB_DESKTOP) return "[VOD WEB]";
  return "[VOD SSR]";
}

function emit(level: Level, args: unknown[]) {
  if (typeof console === "undefined") return;
  const fn = (console as unknown as Record<Level, (...a: unknown[]) => void>)[level] ?? console.log;
  fn(prefix(), ...args);
}

export const vlog = (...args: unknown[]) => emit("log", args);
export const vwarn = (...args: unknown[]) => emit("warn", args);
export const verror = (...args: unknown[]) => emit("error", args);
export const vgroup = (label: string) => {
  if (typeof console === "undefined") return;
  console.group(`${prefix()} ${label}`);
};
export const vgroupEnd = () => {
  if (typeof console === "undefined") return;
  console.groupEnd();
};

export function vodPlatformTag(): string {
  return prefix();
}

// Garantia de plataforma — chama no início de fluxos sensíveis para falhar
// alto caso alguém execute código Web em build Android (ou vice-versa).
export function assertPlatform(kind: "web" | "android"): void {
  if (kind === "web" && !PLATFORM_WEB_DESKTOP) {
    verror(`Bloco WEB executado em plataforma "${platformLabel()}". Vazamento de fluxo.`);
  }
  if (kind === "android" && !PLATFORM_ANDROID) {
    verror(`Bloco ANDROID executado em plataforma "${platformLabel()}". Vazamento de fluxo.`);
  }
}
