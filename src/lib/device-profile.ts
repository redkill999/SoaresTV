// ============================================================================
//  DeviceProfile — fonte única de "que aparelho é esse?"
// ----------------------------------------------------------------------------
//  Antes existiam 4 detecções divergentes de "isNative"/"isTV" espalhadas em
//  xtream.ts, platform.ts, tv-dpad.ts e __root.tsx. Cada uma tinha regras
//  levemente diferentes e o resultado disso é o histórico de bugs registrado
//  em mem://constraints/tv-device-detection e mem://constraints/tv-mode-trigger:
//    - TV Box caindo no painel de celular
//    - Desktop caindo em TV mode e perdendo scroll
//
//  Este módulo NÃO reinventa detecção — ele apenas consolida os sinais
//  existentes (`isNativeAppSync`, `isSmartTvEnv`, `isTvDevice`,
//  `window.__deviceType`) num único DeviceProfile tipado. As chamadas antigas
//  continuam funcionando durante a migração.
//
//  Regras invioláveis (herdadas dos constraints):
//    1. Não usar heurística "sem touch" para inferir TV — WebView Android TV
//       reporta touch, desktop reporta 0. Só valem UA de Smart TV ou a flag
//       `window.__deviceType` injetada por plugin nativo.
//    2. TV mode (canvas 1280×720) só liga para APK nativo ou Smart TV via UA.
//       Nunca para desktop com tela grande sem touch.
// ============================================================================

import { isNativeAppSync } from "./platform";
import { isSmartTvEnv, isTvDevice } from "./tv-dpad";

export type Platform = "web" | "android" | "ios";
export type FormFactor = "phone" | "tablet" | "desktop" | "tv" | "smart-tv" | "unknown";
export type InputMode = "touch" | "mouse-keyboard" | "dpad";

export interface DeviceProfile {
  platform: Platform;
  formFactor: FormFactor;
  inputMode: InputMode;
  isNative: boolean;
  isTv: boolean;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** Flag injetada por plugin nativo (se existir). Fonte mais confiável. */
  injectedType: "tv" | "phone" | "tablet" | null;
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "web";
  if (!isNativeAppSync()) return "web";
  const ua = (navigator.userAgent || "").toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  return "android";
}

function detectInjectedType(): DeviceProfile["injectedType"] {
  if (typeof window === "undefined") return null;
  const t = (window as Window & { __deviceType?: string }).__deviceType;
  if (t === "tv" || t === "phone" || t === "tablet") return t;
  return null;
}

/**
 * Detecção de tablet vs celular apenas quando NÃO é TV.
 * Baseada em menor dimensão da tela — MUITO menos crítica que TV vs celular,
 * porque o layout responsivo cobre ambos. Só serve pra escolher grid.
 */
function detectMobileFormFactor(): "phone" | "tablet" {
  if (typeof window === "undefined") return "phone";
  const w = window.innerWidth;
  const h = window.innerHeight;
  const minDim = Math.min(w, h);
  return minDim >= 600 ? "tablet" : "phone";
}

function detectInputMode(profile: {
  isTv: boolean;
  isNative: boolean;
}): InputMode {
  if (profile.isTv) return "dpad";
  if (typeof window === "undefined") return "mouse-keyboard";
  const hasTouch =
    (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
  if (profile.isNative && hasTouch) return "touch";
  // Desktop: mouse+keyboard (mesmo se laptop tem touch — nunca vira TV mode).
  return "mouse-keyboard";
}

let cached: DeviceProfile | null = null;

/**
 * Retorna o perfil do dispositivo. Cacheado por sessão — mudanças de viewport
 * (rotação) NÃO invalidam o cache, porque isso quebraria os constraints de
 * TV mode (rotação não vira TV, e vice-versa).
 */
export function getDeviceProfile(): DeviceProfile {
  if (cached) return cached;

  const injectedType = detectInjectedType();
  const isNative = isNativeAppSync();
  const platform = detectPlatform();

  // TV: flag nativa vence tudo; senão UA de Smart TV; senão isTvDevice (já respeita ambos).
  const isTv =
    injectedType === "tv"
      ? true
      : injectedType === "phone" || injectedType === "tablet"
        ? false
        : isTvDevice() || isSmartTvEnv();

  let formFactor: FormFactor;
  if (isTv) {
    formFactor = isNative ? "tv" : "smart-tv";
  } else if (isNative) {
    if (injectedType === "tablet") formFactor = "tablet";
    else if (injectedType === "phone") formFactor = "phone";
    else formFactor = detectMobileFormFactor();
  } else {
    formFactor = "desktop";
  }

  const isMobile = formFactor === "phone";
  const isTablet = formFactor === "tablet";
  const isDesktop = formFactor === "desktop";
  const inputMode = detectInputMode({ isTv, isNative });

  cached = {
    platform,
    formFactor,
    inputMode,
    isNative,
    isTv,
    isMobile,
    isTablet,
    isDesktop,
    injectedType,
  };
  return cached;
}

/** Helpers de conveniência — evitam chamar getDeviceProfile() para uma flag só. */
export const isTv = () => getDeviceProfile().isTv;
export const isNative = () => getDeviceProfile().isNative;
export const isMobile = () => getDeviceProfile().isMobile;
export const isDesktop = () => getDeviceProfile().isDesktop;

/** Invalidação manual — usar APENAS em testes. Em produção, o perfil é estável. */
export function __resetDeviceProfileCacheForTests() {
  cached = null;
}
