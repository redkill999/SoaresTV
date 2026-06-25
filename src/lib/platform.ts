// ============================================================================
//  PLATFORM OVERRIDES — fonte única de "isto é APK ou Web?"
// ----------------------------------------------------------------------------
//  Por que existe:
//  Antes, ajustes feitos pro APK (URL absoluta, headers do proxy, enableWorker,
//  ordem de candidatos, etc.) iam direto no VideoPlayer.tsx e acabavam
//  afetando o navegador desktop — porque o mesmo código roda nos dois.
//
//  Regra de ouro a partir de agora:
//      Nunca colocar `if (apk) ... else ...` espalhado pelo player.
//      Toda diferença de comportamento entre APK e Web mora AQUI,
//      como um campo do PlatformConfig. O player só lê config.X.
//
//  Como usar:
//      import { getPlatformConfig, isNativeAppSync } from "@/lib/platform";
//      const cfg = getPlatformConfig();
//      if (cfg.mpegts.enableWorker) { ... }
//
//  Se precisar de um ajuste que só vale pro APK: mude o valor no bloco
//  `apkConfig` abaixo. Se for só pra web: mude `webConfig`. Não toca o player.
// ============================================================================

export type Platform = "apk" | "web";

export interface PlatformConfig {
  platform: Platform;

  /** Sempre absolutizar URLs do proxy contra window.location.origin antes de tocar */
  absolutizeProxyUrl: boolean;

  /** Configurações do mpegts.js */
  mpegts: {
    /** Roda o demux em Web Worker (Blob) — quebra no browser por origin null */
    enableWorker: boolean;
    /** Stash de bytes inicial (kb) */
    stashInitialSize: number;
  };

  /** Configurações do hls.js */
  hls: {
    enableWorker: boolean;
  };

  /** Proxy /api/stream */
  proxy: {
    /** Pular o proxy pra LIVE e tentar URL direta primeiro */
    bypassForLive: boolean;
    /** Forçar Range: bytes=0- em segmentos .ts (alguns hosts cortam o stream) */
    forceRangeOnTs: boolean;
  };

  /** Tentar player nativo (capacitor-video-player) antes do <video> HTML5 */
  preferNativePlayer: boolean;
}

// ----------------------------------------------------------------------------
//  Detecção (síncrona, baseada em UA + bridge — sem await)
// ----------------------------------------------------------------------------

function detectNativeApkSync(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
    SoaresTVNative?: unknown;
    AndroidBridge?: unknown;
  };
  if (w.Capacitor?.isNativePlatform?.()) return true;
  if (w.SoaresTVNative || w.AndroidBridge) return true;
  const ua = (navigator.userAgent || "").toLowerCase();
  // marcador customizado do APK + WebView Android genérico (wv)
  return ua.includes("soarestv-apk") || /android.*; wv\)/.test(ua);
}

let cached: boolean | null = null;
export function isNativeAppSync(): boolean {
  if (cached === null) cached = detectNativeApkSync();
  return cached;
}

// ----------------------------------------------------------------------------
//  Presets por plataforma
// ----------------------------------------------------------------------------

const webConfig: PlatformConfig = {
  platform: "web",
  absolutizeProxyUrl: true, // mpegts worker exige URL absoluta
  mpegts: {
    enableWorker: false, // Blob worker → origin null → "Failed to fetch"
    stashInitialSize: 128,
  },
  hls: {
    enableWorker: true,
  },
  proxy: {
    bypassForLive: false, // browser precisa do proxy (CORS / mixed-content)
    forceRangeOnTs: false, // Range em live .ts derruba o stream
  },
  preferNativePlayer: false,
};

const apkConfig: PlatformConfig = {
  platform: "apk",
  absolutizeProxyUrl: false, // WebView aceita relativo
  mpegts: {
    enableWorker: true, // funciona no WebView Android moderno
    stashInitialSize: 384,
  },
  hls: {
    enableWorker: true,
  },
  proxy: {
    bypassForLive: true, // tenta URL direta do painel primeiro
    forceRangeOnTs: false,
  },
  preferNativePlayer: true, // capacitor-video-player (ExoPlayer)
};

export function getPlatformConfig(): PlatformConfig {
  return isNativeAppSync() ? apkConfig : webConfig;
}
