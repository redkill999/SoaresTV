// =========================================================================
// Playback Engine — helpers puros de decisão para o VideoPlayer.
//
// NÃO é um player. NÃO mantém estado de DOM. Apenas funções determinísticas
// que centralizam:
//   1. Ordem de engines (Exo → mpegts → html5 → hls) por ambiente + perfil
//   2. Classificação de erros (proxy morto, timeout, decode, network)
//   3. Log unificado sob prefixo [PLAYBACK ENGINE]
//
// A persistência por host vive em `host-profile.ts` (única fonte da verdade).
// O VideoPlayer consome estas funções; nenhum outro módulo deve chamar
// player diretamente.
// =========================================================================

import {
  getHostProfile,
  isProxyDeadStatus,
  type PlaybackStrategy,
} from "@/lib/host-profile";

export type Environment = "native-apk" | "web";
export type StreamKind = "live" | "vod";

/**
 * Ordem fixa pedida pelo PLAYBACK ENGINE 5.0:
 *   APK: ExoPlayer nativo > mpegts.js > HTML5 > HLS
 *   Web: HLS-first para LIVE Xtream (ExoPlayer não existe no browser e
 *        mpegts.js direto falha em painéis com CORS — decisão histórica
 *        validada com esma26.top e similares). VOD usa HTML5 direto.
 *
 * Quando o host tem `preferPlayer` memorizado, ele é promovido para a frente
 * (mantendo as demais como fallback). Isso evita redescobrir a estratégia
 * funcional em cada sessão.
 */
export function decideEngineOrder(
  host: string | null,
  kind: StreamKind | undefined,
  env: Environment,
): PlaybackStrategy[] {
  const baseApk: PlaybackStrategy[] = ["exo-native", "mpegts", "html5", "hls"];
  const baseWebLive: PlaybackStrategy[] = ["hls", "mpegts", "html5"];
  const baseWebVod: PlaybackStrategy[] = ["html5", "hls"];

  let order =
    env === "native-apk"
      ? baseApk
      : kind === "live"
        ? baseWebLive
        : baseWebVod;

  const preferred = host ? getHostProfile(host).preferPlayer : undefined;
  if (preferred && order.includes(preferred)) {
    order = [preferred, ...order.filter((s) => s !== preferred)];
  }
  return order;
}

export type ErrorClass =
  | "proxy-dead"      // 502/503/504 do proxy ou upstream
  | "timeout"         // watchdog estourou sem metadata
  | "decode"          // mediaError / codec
  | "network"         // fetch / load error transitório
  | "manifest"        // HLS manifest 404 / parse fail
  | "unknown";

export function classifyError(input: {
  proxyStatus?: number | string | null;
  upstreamStatus?: number | string | null;
  mediaErrorCode?: number | null;
  reason?: string | null;
}): ErrorClass {
  if (isProxyDeadStatus(input.proxyStatus) || isProxyDeadStatus(input.upstreamStatus)) {
    return "proxy-dead";
  }
  const code = input.mediaErrorCode ?? 0;
  // MediaError: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
  if (code === 3) return "decode";
  if (code === 2) return "network";
  if (code === 4) return "manifest";
  const reason = (input.reason ?? "").toLowerCase();
  if (reason.includes("timeout") || reason.includes("watchdog")) return "timeout";
  if (reason.includes("manifest")) return "manifest";
  return "unknown";
}

// =========================================================================
// Log unificado. Mantém o prefixo [PLAYBACK ENGINE] em todas as etapas
// para facilitar grep no console e no logcat do APK.
// =========================================================================
