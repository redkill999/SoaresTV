// ============================================================================
// PLATFORM FLAGS — separação explícita entre Web Desktop, Android APK e TV.
//
// Pedido na auditoria de player VOD para evitar mistura de regras:
//   - PLATFORM_WEB_DESKTOP: navegador (Chrome/Edge/Firefox/Safari) em PC/Mac.
//     Player HTML5 + HLS.js + proxy /api/stream + CORS.
//   - PLATFORM_ANDROID:     APK Capacitor genérico (celular/tablet/box).
//     ExoPlayer nativo via capacitor-video-player + HTTP nativo.
//   - PLATFORM_ANDROID_TV:  variação do APK com D-Pad / TV-mode (canvas 1280×720).
//     Mesmas regras do APK.
//
// Regra: alterações de comportamento Web Desktop NÃO podem alterar Android,
// e vice-versa. Quem precisar de fork de fluxo lê esses flags.
// ============================================================================

import { isNativeAppSync } from "@/lib/platform";

const isBrowser = typeof window !== "undefined";

function detectAndroidTv(): boolean {
  if (!isBrowser) return false;
  const ua = (navigator.userAgent || "").toLowerCase();
  // TV-mode trigger documentado em mem://constraints/tv-mode-trigger:
  // só liga para Android TV via UA — nunca por tamanho de tela.
  return /android.*tv|smarttv|googletv|crkey|aftt|aftb|aftm|aft[a-z0-9]+/i.test(ua);
}

export const PLATFORM_ANDROID: boolean = isNativeAppSync();
export const PLATFORM_ANDROID_TV: boolean = PLATFORM_ANDROID && detectAndroidTv();
export const PLATFORM_WEB_DESKTOP: boolean = !PLATFORM_ANDROID && isBrowser;

export function platformLabel(): "web-desktop" | "android" | "android-tv" | "ssr" {
  if (PLATFORM_ANDROID_TV) return "android-tv";
  if (PLATFORM_ANDROID) return "android";
  if (PLATFORM_WEB_DESKTOP) return "web-desktop";
  return "ssr";
}
