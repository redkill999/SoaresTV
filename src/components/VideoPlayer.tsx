import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { Maximize, Pause, PictureInPicture2, PictureInPicture, Play } from "lucide-react";
import { toast } from "sonner";
import { isNativeApp } from "@/lib/xtream";
import { getHostProfile, hostOf, rememberHlsUnsupported, rememberWebIncompatibleLive, updateHostProfile } from "@/lib/host-profile";
import { playNative, stopNative, getNativeCurrentTime } from "@/lib/native-player";
import { store, getCompatForUrl, USER_AGENT_STRINGS, type AppSettings, type AspectRatio, type ListCompat } from "@/lib/storage";
import { maskIptvUrl } from "@/lib/iptv-url";



// Module-level cache do mpegts.js: a 1ª troca de canal paga o import, as
// seguintes reusam a mesma referência (sem reparse de bundle nem nova Promise).
let mpegtsModule: typeof import("mpegts.js").default | null = null;
let mpegtsLoading: Promise<typeof import("mpegts.js").default> | null = null;
async function loadMpegts() {
  if (mpegtsModule) return mpegtsModule;
  if (!mpegtsLoading) {
    mpegtsLoading = import("mpegts.js")
      .then((m) => {
        mpegtsModule = m.default;
        return mpegtsModule;
      })
      .catch((err) => {
        // Reseta para permitir nova tentativa na próxima troca de canal,
        // em vez de manter uma Promise rejeitada para sempre.
        mpegtsLoading = null;
        throw err;
      });
  }
  return mpegtsLoading;
}

type MpegTsPlayer = {
  destroy(): void;
  unload(): void;
  detachMediaElement(): void;
  pause(): void;
  attachMediaElement(mediaElement: HTMLMediaElement): void;
  load(): void;
  play(): Promise<void> | void;
  on(event: string, listener: (...args: unknown[]) => void): void;
};

async function lockLandscape() {
  try {
    const { ScreenOrientation } = await import("@capacitor/screen-orientation");
    await ScreenOrientation.lock({ orientation: "landscape" });
  } catch {
    // not native or plugin unavailable
  }
}

async function unlockOrientation() {
  try {
    const { ScreenOrientation } = await import("@capacitor/screen-orientation");
    await ScreenOrientation.unlock();
  } catch {
    // ignore
  }
}

// Xtream live URLs often come as `.ts` (raw MPEG-TS). Some providers expose an
// HLS variant, but hosts with disableHlsConversion/preferTs must keep the
// original `.ts` first. Everything flows through /api/stream on Web Desktop to
// avoid CORS / mixed-content, unless native transport is explicitly selected.
function toHlsCandidate(src: string, kind?: "live" | "vod"): string | null {
  if (kind === "vod" || /\/movie\/[^/]+\/[^/]+\//i.test(src) || /\/series\/[^/]+\/[^/]+\//i.test(src)) return null;
  if (/\.m3u8(\?|$)/i.test(src)) return src;
  // Apenas streams ao vivo têm variante HLS no Xtream.
  // VOD (movie/series) precisa ser reproduzido direto como mp4/mkv.
  if (/\/live\/[^/]+\/[^/]+\/\d+\.[a-z0-9]+(\?|$)/i.test(src)) {
    return src.replace(/\.[a-z0-9]+(\?|$)/i, ".m3u8$1");
  }
  return null;
}

function proxied(url: string, kind?: "live" | "vod"): string {
  const k = kind === "vod" ? "&kind=vod" : kind === "live" ? "&kind=live" : "";
  return `/api/stream?u=${encodeURIComponent(url)}${k}&v=7`;
}

type StreamProbeResult = {
  ok: boolean;
  status: number;
  contentType: string;
  finalUrlHost: string;
  reason?: string;
  bodyPreview?: string;
};

function probeUrlForCandidate(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname !== "/api/stream") return null;
    parsed.searchParams.set("probe", "1");
    parsed.searchParams.set("kind", "live");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function messageForProbeStatus(status: number): string {
  if (status === 401 || status === 403) {
    return "Servidor recusou a reprodução: usuário sem autorização, conta expirada, limite de conexões ou URL inválida.";
  }
  if (status === 404) return "Stream não encontrado no servidor. A URL do canal pode estar errada.";
  if (status === 424 || status === 502 || status === 503 || status === 504) {
    return "Proxy não conseguiu abrir o stream. O servidor pode estar bloqueando o IP do Web Desktop.";
  }
  return "Não foi possível reproduzir este canal.";
}

async function probeNativeLiveStream(
  url: string,
  onLine: (line: string) => void,
  isCancelled: () => boolean,
) {
  const uaList: Array<[string, string]> = [
    ["XCIPTV", USER_AGENT_STRINGS.xciptv],
    ["TiviMate", USER_AGENT_STRINGS.tivimate],
    ["Smarters", USER_AGENT_STRINGS.smarters],
    ["okhttp", USER_AGENT_STRINGS.okhttp],
    ["Chrome", USER_AGENT_STRINGS.chrome],
  ];

  try {
    const { Capacitor, CapacitorHttp } = await import("@capacitor/core");
    const canUseHttp =
      Capacitor.isNativePlatform?.() ||
      Capacitor.getPlatform?.() === "android" ||
      Capacitor.getPlatform?.() === "ios" ||
      !!(window as unknown as { Capacitor?: unknown }).Capacitor;
    if (!canUseHttp) {
      onLine("ETAPA 4.0 probe nativo indisponível neste ambiente");
      return;
    }

    onLine(`ETAPA 4.0 probe GET url=${maskIptvUrl(url)}`);
    const httpReq = (CapacitorHttp as unknown as {
      request: (opts: Record<string, unknown>) => Promise<{
        status?: number;
        headers?: Record<string, string>;
        data?: unknown;
      }>;
    }).request;
    let firstOk: string | null = null;
    for (const [idx, [label, ua]] of uaList.entries()) {
      if (isCancelled()) return;
      try {
        const started = Date.now();
        // NOTE: muitos IPTV rejeitam Range em LIVE com 403 — não enviamos Range.
        const res = await httpReq({
          method: "GET",
          url,
          headers: {
            "User-Agent": ua,
            "Accept": "*/*",
            "Icy-MetaData": "1",
          },
          connectTimeout: 4_000,
          readTimeout: 4_000,
          responseType: "text",
        });
        if (isCancelled()) return;
        const headers = res.headers ?? {};
        const contentType = headers["content-type"] ?? headers["Content-Type"] ?? "-";
        const contentLength = headers["content-length"] ?? headers["Content-Length"] ?? "-";
        const bodyPreview =
          typeof res.data === "string" ? maskIptvUrl(res.data.slice(0, 80).replace(/\s+/g, " ")) : "";
        onLine(
          `ETAPA 4.${idx + 1} UA=${label} status=${res.status ?? "?"} ct=${contentType} len=${contentLength} ms=${Date.now() - started}${bodyPreview ? ` body="${bodyPreview}"` : ""}`,
        );
        if (res.status && res.status >= 200 && res.status < 400 && !firstOk) {
          firstOk = label;
        }
      } catch (err) {
        if (isCancelled()) return;
        const msg = err instanceof Error ? err.message : String(err);
        onLine(`ETAPA 4.${idx + 1} UA=${label} erro=${msg.slice(0, 140)}`);
      }
    }
    if (firstOk) {
      onLine(`ETAPA 4.X UA recomendado para ExoPlayer: ${firstOk}`);
    } else {
      onLine("ETAPA 4.X nenhum UA passou — servidor pode estar bloqueando este IP/região");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onLine(`ETAPA 4 probe falhou=${msg.slice(0, 160)}`);
  }
}

function isHlsUrl(url: string): boolean {
  return /\.m3u8([?#&]|$)/i.test(url);
}

function isTsUrl(url: string): boolean {
  return /\.ts([?#&]|$)/i.test(url);
}

// Mantém a URL original como primeira tentativa e gera a variante alternativa
// (.m3u8 ↔ .ts) apenas como fallback. Crítico: se o src veio .m3u8 da M3U,
// NUNCA jogar o .m3u8 fora — disableHlsConversion só bloqueia inventar .m3u8
// a partir de um .ts, jamais o contrário.
function liveDirectCandidates(src: string): string[] {
  const out: string[] = [];
  const add = (url: string | null) => {
    if (url && !out.includes(url)) out.push(url);
  };
  add(src);
  if (isHlsUrl(src)) {
    add(src.replace(/\.m3u8(\?|$)/i, ".ts$1"));
  } else if (isTsUrl(src)) {
    // Web Desktop não reproduz MPEG-TS direto no <video>, e mpegts.js pode
    // falhar em codecs AAC/HE-AAC que o HLS do próprio provedor toca. Mantemos
    // a URL original, mas adicionamos a playlist HLS logo em seguida.
    add(src.replace(/\.ts(\?|$)/i, ".m3u8$1"));
  } else {
    // M3U Xtream pode vir sem extensão (/usuario/senha/id). Mantém a URL real
    // primeiro e só depois tenta os sufixos conhecidos, sem reconstruir caminho.
    try {
      const parsed = new URL(src);
      if (!/\.[a-z0-9]+$/i.test(parsed.pathname)) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        const tail = `${parsed.search}${parsed.hash}`;
        // Xtream output=ts frequentemente vem no formato curto
        //   /usuario/senha/id
        // O fallback correto NÃO é /usuario/senha/id.ts (404 em flipex.pro),
        // e sim /live/usuario/senha/id.ts. Mantém a URL curta original como
        // primeira tentativa e adiciona as variantes Xtream reais depois.
        if (parts.length === 3 && /^\d+$/.test(parts[2])) {
          add(`${parsed.origin}/live/${parts[0]}/${parts[1]}/${parts[2]}.m3u8${tail}`);
          add(`${parsed.origin}/live/${parts[0]}/${parts[1]}/${parts[2]}.ts${tail}`);
        } else {
          const base = src.replace(/([?#].*)$/, "");
          add(`${base}.ts${tail}`);
          add(`${base}.m3u8${tail}`);
        }
      }
    } catch {
      // mantém apenas a URL original
    }
  }
  return out;
}

function httpsVariant(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return /^https:$/i.test(parsed.protocol) ? parsed.toString() : null;
    parsed.protocol = "https:";
    if (parsed.port === "80") parsed.port = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Reescreve uma URL HTTP para HTTPS na porta oficial do provedor (vinda de
 * server_info.https_port). Usado APENAS em LIVE quando o host tem `httpsPort`
 * no perfil — permite o navegador conectar direto sem proxy nem mixed-content.
 */
function httpsVariantWithPort(url: string, httpsPort: number): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && Number(parsed.port || 443) === httpsPort) {
      return parsed.toString();
    }
    parsed.protocol = "https:";
    parsed.port = String(httpsPort);
    return parsed.toString();
  } catch {
    return null;
  }
}

// Detecção automática do formato pela extensão da URL.
//   .m3u8 / .m3u  → "hls"   (hls.js no web, ExoPlayer nativo no APK)
//   .ts           → "ts"    (mpegts.js no web, ExoPlayer nativo no APK)
//   .mp4 / .m4v / .mov → "mp4" (<video> nativo do navegador)
//   .mkv          → "mkv"   (ExoPlayer nativo no APK; web tenta <video> mas
//                             a maioria dos browsers não decoda mkv)
//   sem extensão  → "auto"  (deixa a heurística atual decidir)
export type DetectedFormat = "hls" | "ts" | "mp4" | "mkv" | "auto";

export function detectFormat(url: string): DetectedFormat {
  try {
    const path = new URL(url, "http://x").pathname.toLowerCase();
    if (/\.m3u8?(?:$|\?)/.test(path)) return "hls";
    if (/\.ts(?:$|\?)/.test(path)) return "ts";
    if (/\.(mp4|m4v|mov)(?:$|\?)/.test(path)) return "mp4";
    if (/\.mkv(?:$|\?)/.test(path)) return "mkv";
    return "auto";
  } catch {
    return "auto";
  }
}

export type VideoPlayerHandle = {
  /** Faz seek apenas se o vídeo estiver no caminho web (<video> visível). */
  seekTo: (seconds: number) => void;
};

export function VideoPlayer({
  src,
  poster,
  kind,
  initialPosition,
  onProgress,
  mediaId,
  mediaKind,
  onReady,
}: {
  src: string;
  poster?: string;
  kind?: "live" | "vod";
  initialPosition?: number;
  onProgress?: (positionSec: number, durationSec: number) => void;
  /** Quando informados, o player salva progresso direto em store.updateProgress
   *  (em paralelo a onProgress, se houver). Ignorado para kind="live". */
  mediaId?: string;
  mediaKind?: "movie" | "series";
  /** Chamado uma vez no primeiro `canplay`, com handle para seekTo. */
  onReady?: (handle: VideoPlayerHandle) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [canManualPlay, setCanManualPlay] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => store.getAppSettings());
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [holdNativeDebug, setHoldNativeDebug] = useState(false);
  const keepDebugOverlayRef = useRef(false);
  const manualNativeStartRef = useRef(false);
  const nativeRuntimeRef = useRef(false);

  // [DEBUG TEMP] Coleta de etapas do pipeline de reprodução, exibido em overlay
  // quando ocorre erro. Limpo no início de cada nova fonte (src).
  const dbgRef = useRef<string[]>([]);
  const [dbgLines, setDbgLines] = useState<string[]>([]);
  const pushDbg = useCallback((line: string) => {
    const stamp = new Date().toISOString().slice(11, 23);
    const entry = `[${stamp}] ${line}`;
    dbgRef.current = [...dbgRef.current, entry].slice(-40);
    setDbgLines(dbgRef.current);
    // eslint-disable-next-line no-console
    console.log("[STREAM DEBUG]", entry);
  }, []);
  const showStreamDiagnostic = useCallback((message: string) => {
    keepDebugOverlayRef.current = true;
    setDebugPanelOpen(true);
    setError(message);
  }, []);
  // "deciding" = aguardando saber se rodaremos no ExoPlayer nativo (APK) ou no
  // <video>/MSE (web). "native" = plugin abriu overlay fullscreen, MSE inativo.
  // "web" = caminho clássico hls.js/mpegts.js.
  const [playerMode, setPlayerMode] = useState<"deciding" | "native" | "web">("deciding");
  const nativeLiveWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeLivePlayedRef = useRef(false);
  // Watchdog contínuo de stall para reprodução LIVE via ExoPlayer nativo.
  // Mesmo padrão do apkLiveProgressTimer do caminho web, mas usando
  // getNativeCurrentTime() do plugin capacitor-video-player.
  const nativeLiveStallIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nativeLiveLastTimeRef = useRef<number>(0);
  const nativeLiveStillTicksRef = useRef<number>(0);
  const nativeLivePausedRef = useRef<boolean>(false);
  const nativeLiveReloadEventsRef = useRef<number[]>([]);
  const nativeLiveReloadingRef = useRef<boolean>(false);
  const stopNativeLiveStallWatchdog = useCallback(() => {
    if (nativeLiveStallIntervalRef.current) {
      clearInterval(nativeLiveStallIntervalRef.current);
      nativeLiveStallIntervalRef.current = null;
    }
    nativeLiveStillTicksRef.current = 0;
  }, []);
  const initialPositionRef = useRef(initialPosition ?? 0);
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    initialPositionRef.current = initialPosition ?? 0;
  }, [initialPosition]);
  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);
  useEffect(() => store.subscribeAppSettings(() => setSettings(store.getAppSettings())), []);

  const srcHostProfile = useMemo(() => getHostProfile(hostOf(src)), [src]);
  const isLiveSrc = kind === "live" || /\/live\/[^/]+\/[^/]+\//i.test(src);

  // --- Decisão de player + ponte ExoPlayer ---------------------------------
  // No APK Android (Capacitor) tentamos o plugin nativo `capacitor-video-player`
  // que usa ExoPlayer/Media3 em overlay fullscreen, fora do WebView. Ganhos:
  //  - codecs HEVC/AC3/EAC3 com decoder de hardware (canais que travam no MSE
  //    do WebView geralmente rodam liso aqui)
  //  - MPEG-TS sem demux JS (sem mpegts.js)
  //  - headers customizados (User-Agent estilo XCIPTV) direto no request
  //  - bypassa o proxy /api/stream (vai direto pro painel via http)
  // Se o plugin falhar (plugin ausente, URL incompatível), caímos pro caminho
  // web (hls.js/mpegts) que continua existindo.
  // Ref indireto para o reloader do watchdog nativo — evita ciclo de deps
  // (startNativeLiveStallWatchdog precisa ser criado antes de openNative,
  // mas o reloader depende de openNative).
  const reloadNativeLiveRef = useRef<() => void>(() => {});

  const startNativeLiveStallWatchdog = useCallback(() => {
    if (!isLiveSrc) return;
    stopNativeLiveStallWatchdog();
    nativeLiveLastTimeRef.current = 0;
    nativeLiveStillTicksRef.current = 0;
    nativeLivePausedRef.current = false;
    nativeLiveStallIntervalRef.current = setInterval(() => {
      if (!nativeOpenedRef.current) { stopNativeLiveStallWatchdog(); return; }
      if (nativeLivePausedRef.current || nativeLiveReloadingRef.current) return;
      void (async () => {
        const t = await getNativeCurrentTime();
        if (t == null) return;
        // Primeiro tick: apenas semear baseline.
        if (nativeLiveLastTimeRef.current === 0 && nativeLiveStillTicksRef.current === 0) {
          nativeLiveLastTimeRef.current = t;
          return;
        }
        if (t > nativeLiveLastTimeRef.current + 0.25) {
          nativeLiveLastTimeRef.current = t;
          nativeLiveStillTicksRef.current = 0;
          return;
        }
        nativeLiveStillTicksRef.current += 1;
        pushDbg(`NATIVE LIVE stall tick=${nativeLiveStillTicksRef.current} t=${t.toFixed(2)}`);
        if (nativeLiveStillTicksRef.current >= 2) {
          nativeLiveStillTicksRef.current = 0;
          reloadNativeLiveRef.current();
        }
      })();
    }, 4_000);
  }, [isLiveSrc, pushDbg, stopNativeLiveStallWatchdog]);

  const openNative = useCallback(async () => {
    const native = await isNativeApp();
    nativeRuntimeRef.current = native;
    if (!native) return false;

    nativeLivePlayedRef.current = false;
    if (nativeLiveWatchdogRef.current) {
      clearTimeout(nativeLiveWatchdogRef.current);
      nativeLiveWatchdogRef.current = null;
    }
    stopNativeLiveStallWatchdog();
    nativeLivePausedRef.current = false;
    const compat = getCompatForUrl(src);
    const ua =
      compat.userAgent && compat.userAgent !== "auto"
        ? USER_AGENT_STRINGS[compat.userAgent]
        : isLiveSrc && srcHostProfile.forceNativeForLive
          ? USER_AGENT_STRINGS.xciptv
        : "XCIPTV/7.0 (Linux; Android 13)";
    pushDbg(`ETAPA 3.1 native UA=${ua}`);
    return playNative({
      url: src,
      userAgent: ua,
      isLive: isLiveSrc,
      startAtSec: kind !== "live" ? initialPositionRef.current : undefined,
      onEvent: (name, data) => {
        try {
          const payload = typeof data === "string" ? data : JSON.stringify(data);
          pushDbg(`NATIVE ${name} ${payload ? maskIptvUrl(payload).slice(0, 200) : ""}`);
        } catch {
          pushDbg(`NATIVE ${name}`);
        }
        if (name === "jeepCapVideoPlayerPause" || /\bpause\b/i.test(name)) {
          nativeLivePausedRef.current = true;
        }
        if (
          name === "jeepCapVideoPlayerReady" ||
          name === "jeepCapVideoPlayerPlay" ||
          /\b(?:ready|play)\b/i.test(name)
        ) {
          nativeLivePlayedRef.current = true;
          nativeLivePausedRef.current = false;
          if (nativeLiveWatchdogRef.current) {
            clearTimeout(nativeLiveWatchdogRef.current);
            nativeLiveWatchdogRef.current = null;
          }
          if (isLiveSrc && nativeOpenedRef.current) {
            startNativeLiveStallWatchdog();
          }
        }
        if (
          name === "jeepCapVideoPlayerEnded" ||
          name === "jeepCapVideoPlayerExit" ||
          /\b(?:ended|exit)\b/i.test(name)
        ) {
          stopNativeLiveStallWatchdog();
        }
        // Se o ExoPlayer emitir erro explícito, fecha o overlay nativo (que
        // estava cobrindo o WebView) e mostra o painel de diagnóstico em tela.
        if (
          name === "jeepCapVideoPlayerError" ||
          name === "initPlayer:false" ||
          name === "exception" ||
          /error|fail/i.test(name)
        ) {
          pushDbg(`ETAPA 9 native error -> fechando overlay nativo para exibir diag`);
          if (nativeLiveWatchdogRef.current) {
            clearTimeout(nativeLiveWatchdogRef.current);
            nativeLiveWatchdogRef.current = null;
          }
          stopNativeLiveStallWatchdog();
          void stopNative().catch(() => undefined);
          nativeOpenedRef.current = false;
          setPlayerMode("web");
          showStreamDiagnostic("Não foi possível reproduzir este canal (ExoPlayer). Veja o diagnóstico abaixo.");
        }
      },
      onExit: (pos) => {
        pushDbg(`NATIVE exit pos=${pos}`);
        if (nativeLiveWatchdogRef.current) {
          clearTimeout(nativeLiveWatchdogRef.current);
          nativeLiveWatchdogRef.current = null;
        }
        stopNativeLiveStallWatchdog();
        if (kind !== "live" && pos > 0) {
          onProgressRef.current?.(pos, Math.max(pos + 1, pos));
        }
      },
    });
  }, [src, kind, isLiveSrc, srcHostProfile.forceNativeForLive, pushDbg, showStreamDiagnostic, startNativeLiveStallWatchdog, stopNativeLiveStallWatchdog]);

  // Reload do canal LIVE no ExoPlayer nativo ao detectar stall. Limitado a
  // 2 tentativas por janela de 90s (mesma lógica do apkLiveFreezeEvents do
  // caminho web). Após o limite, cai para diagnóstico.
  const reloadNativeLive = useCallback(async () => {
    if (nativeLiveReloadingRef.current) return;
    if (!nativeOpenedRef.current || !isLiveSrc) return;
    const now = Date.now();
    const arr = nativeLiveReloadEventsRef.current;
    while (arr.length && now - arr[0] > 90_000) arr.shift();
    if (arr.length >= 2) {
      pushDbg(`NATIVE LIVE stall reload limite (${arr.length}/90s) -> diagnóstico`);
      stopNativeLiveStallWatchdog();
      nativeOpenedRef.current = false;
      void stopNative().catch(() => undefined);
      setPlayerMode("web");
      showStreamDiagnostic("Canal LIVE congelando repetidamente no ExoPlayer. Veja o diagnóstico abaixo.");
      return;
    }
    arr.push(now);
    nativeLiveReloadingRef.current = true;
    stopNativeLiveStallWatchdog();
    pushDbg(`NATIVE LIVE stall detectado -> reload #${arr.length}`);
    try { await stopNative(); } catch { /* ignore */ }
    await new Promise<void>((r) => setTimeout(r, 300));
    const ok = await openNative();
    nativeLiveReloadingRef.current = false;
    if (!ok) {
      nativeOpenedRef.current = false;
      setPlayerMode("web");
      showStreamDiagnostic("Falha ao recarregar o canal LIVE no ExoPlayer.");
    } else {
      nativeOpenedRef.current = true;
    }
  }, [isLiveSrc, openNative, pushDbg, showStreamDiagnostic, stopNativeLiveStallWatchdog]);

  useEffect(() => {
    reloadNativeLiveRef.current = () => { void reloadNativeLive(); };
  }, [reloadNativeLive]);




  // REVERT (estado que funcionava no APK): LIVE toca pelo pipeline web
  // (proxy /api/stream + hls.js/mpegts) dentro da WebView. ExoPlayer nativo
  // só é usado quando o usuário escolhe "exo" nas configurações ou quando o
  // perfil do host exige (forceNativeForLive). Forçar ExoPlayer para todo
  // LIVE foi o que quebrou os canais no APK.
  const shouldUseNativePlayer =
    settings.defaultPlayer === "exo" || (isLiveSrc && !!srcHostProfile.forceNativeForLive);



  // Rastreia se o player nativo (ExoPlayer overlay) foi de fato aberto.
  // Sem isso, o cleanup chamava stopNative() em modo "web" também,
  // potencialmente matando outra instância do plugin.
  const nativeOpenedRef = useRef(false);

  const launchNativeFromDebug = useCallback(async () => {
    manualNativeStartRef.current = true;
    keepDebugOverlayRef.current = false;
    setHoldNativeDebug(false);
    setError(null);
    setPlayerMode("deciding");
    pushDbg("ETAPA 4.9 usuário iniciou ExoPlayer a partir do diagnóstico");
    const ok = await openNative();
    pushDbg(`ETAPA 5 native openNative=${ok}`);
    if (ok) {
      nativeOpenedRef.current = true;
      setPlayerMode("native");
      if (isLiveSrc) {
        if (nativeLiveWatchdogRef.current) clearTimeout(nativeLiveWatchdogRef.current);
        nativeLiveWatchdogRef.current = setTimeout(() => {
          if (!nativeOpenedRef.current || nativeLivePlayedRef.current) return;
          pushDbg("ETAPA 9 native watchdog manual: sem evento READY/PLAY; fechando ExoPlayer para mostrar diagnóstico");
          nativeOpenedRef.current = false;
          setPlayerMode("web");
          showStreamDiagnostic("Canal LIVE preso no ExoPlayer antes de tocar. Veja o diagnóstico abaixo.");
          void stopNative().catch(() => undefined);
          setTimeout(() => { void stopNative().catch(() => undefined); }, 4_000);
        }, 35_000);
      }
      return;
    }
    nativeOpenedRef.current = false;
    setPlayerMode("web");
    showStreamDiagnostic("Falha ao abrir o ExoPlayer para este canal LIVE. Veja o diagnóstico abaixo.");
  }, [openNative, isLiveSrc, pushDbg, showStreamDiagnostic]);

  useEffect(() => {
    let cancelled = false;
    setPlayerMode("deciding");
    nativeOpenedRef.current = false;
    // Reset watchdog de stall nativo por canal (novo src = zera contagem 90s).
    nativeLiveReloadEventsRef.current = [];
    nativeLiveReloadingRef.current = false;
    stopNativeLiveStallWatchdog();
    // [DEBUG TEMP] reset por src
    dbgRef.current = [];
    setDbgLines([]);
    setDebugPanelOpen(false);
    setHoldNativeDebug(false);
    keepDebugOverlayRef.current = false;
    manualNativeStartRef.current = false;
    setError(null);
    pushDbg(`ETAPA 1 src=${maskIptvUrl(src)}`);
    pushDbg(`ETAPA 2 kind=${kind ?? "auto"} host=${hostOf(src)} profile=${JSON.stringify(srcHostProfile)}`);
    (async () => {
      const native = await isNativeApp();
      if (cancelled) return;
      // Registra o runtime nativo ANTES do pipeline web rodar: o guard de
      // webIncompatibleLive só vale para navegador real — no APK o pipeline
      // web (proxy) deve rodar normalmente.
      nativeRuntimeRef.current = native;
      pushDbg(`ETAPA 3 isNativeApp=${native} shouldUseNative=${shouldUseNativePlayer}`);
      if (!native) {
        setPlayerMode("web");
        return;
      }
      if (!shouldUseNativePlayer) {
        setPlayerMode("web");
        return;
      }
      // Gate de diagnóstico pré-ExoPlayer aplica-se SOMENTE a canais LIVE
      // (caso histórico em que o overlay nativo travava sem feedback). Para
      // VOD (filme/série) o ExoPlayer é aberto diretamente — o gate adicionava
      // ~probe + clique manual e atrasava a reprodução sem benefício real.
      if (isLiveSrc) {
        pushDbg("ETAPA 4 LIVE/APK: abrindo ExoPlayer automaticamente");
      }



      const ok = await openNative();
      pushDbg(`ETAPA 4 native openNative=${ok}`);
      if (ok) nativeOpenedRef.current = true;
      if (!ok) {
        pushDbg("ETAPA 9 native init falhou/timeout; exibindo diagnóstico sem cair em loop");
        nativeOpenedRef.current = false;
        setPlayerMode("web");
        showStreamDiagnostic("Falha ao abrir o ExoPlayer. Veja o diagnóstico abaixo.");
        return;
      }
      if (ok && isLiveSrc) {
        nativeLiveWatchdogRef.current = setTimeout(() => {
          if (cancelled || !nativeOpenedRef.current || nativeLivePlayedRef.current) return;
          pushDbg("ETAPA 9 native watchdog: sem evento READY/PLAY; fechando ExoPlayer para mostrar diagnóstico");
          // FIX E: stopNative() é fire-and-forget — closeFullscreen() pode travar
          // no Android (ExoPlayer em loading state). Disparamos setPlayerMode/setError
          // imediatamente para o React atualizar o DOM; o timer de segurança de 4 s
          // garante que a segunda chamada de stopNative() tente novamente caso o
          // overlay nativo não tenha fechado na primeira tentativa.
          nativeOpenedRef.current = false;
          setPlayerMode("web");
          showStreamDiagnostic("Canal LIVE preso no ExoPlayer antes de tocar. Veja o diagnóstico abaixo.");
          void stopNative().catch(() => undefined);
          setTimeout(() => { void stopNative().catch(() => undefined); }, 4_000);
        }, 35_000);
      }
      if (cancelled) {
        if (ok) void stopNative();
        return;
      }
      setPlayerMode(ok ? "native" : "web");
    })();
    return () => {
      cancelled = true;
      // Só mata o ExoPlayer se ele foi realmente aberto por esta instância.
      if (nativeOpenedRef.current) {
        void stopNative();
        nativeOpenedRef.current = false;
      }
      if (nativeLiveWatchdogRef.current) {
        clearTimeout(nativeLiveWatchdogRef.current);
        nativeLiveWatchdogRef.current = null;
      }
      stopNativeLiveStallWatchdog();
    };
  }, [src, kind, openNative, shouldUseNativePlayer, srcHostProfile, pushDbg, isLiveSrc, showStreamDiagnostic, stopNativeLiveStallWatchdog]);

  const videoClass = useMemo(() => {
    const base = "h-full w-full bg-player";
    switch (settings.aspectRatio) {
      case "16:9":   return `${base} object-contain`;
      case "4:3":    return `${base} object-contain`;
      case "fill":   return `${base} object-cover`;
      case "stretch":return `${base} object-fill`;
      default:       return `${base} object-contain`;
    }
  }, [settings.aspectRatio]);

  useEffect(() => {
    // No APK, o ExoPlayer nativo cuida do playback — pulamos MSE.
    if (holdNativeDebug) return;
    if (playerMode !== "web") return;
    const video = videoRef.current;
    if (!video || !src) return;
    if (!keepDebugOverlayRef.current) setError(null);
    setCanManualPlay(false);

    // ---- Compatibilidade por lista ----------------------------------------
    // Resolve overrides salvos para o host desta URL (UA, transporte, formato,
    // upgrade HTTPS). Esses ajustes substituem o comportamento default.
    const baseHostProfile = getHostProfile(hostOf(src));
    const compat: ListCompat = getCompatForUrl(src);
    // CRÍTICO: alguns provedores IPTV (ex.: flipex.pro) não têm HTTPS válido
    // no painel/stream. Se o perfil do host diz forceHttp, qualquer override
    // salvo de "forçar HTTPS" deve ser ignorado para não quebrar canais/VOD.
    const mayUseHttpsVariant = !baseHostProfile.forceHttp;
    const httpsSrc = compat.forceHttps && mayUseHttpsVariant ? httpsVariant(src) : null;
    const workingSrc = httpsSrc ?? src;
    const forcedUA = compat.userAgent && compat.userAgent !== "auto"
      ? USER_AGENT_STRINGS[compat.userAgent]
      : null;
    const proxiedX = (u: string, k?: "live" | "vod") =>
      forcedUA ? `${proxied(u, k)}&ua=${encodeURIComponent(forcedUA)}` : proxied(u, k);
    const forceProxy = compat.transport === "proxy";
    const forceDirect = compat.transport === "direct";
    // Detecção automática pelo sufixo da URL. Override do usuário (compat)
    // tem prioridade absoluta; só caímos na auto-detect quando ele não fixou.
    const auto = detectFormat(workingSrc);
    const isVod = kind === "vod" || /\/movie\/[^/]+\/[^/]+\//i.test(workingSrc) || /\/series\/[^/]+\/[^/]+\//i.test(workingSrc);
    // CRÍTICO: listas M3U de alguns painéis (ex.: flipex.pro) entregam LIVE no
    // formato curto /usuario/senha/id, sem /live/ e sem extensão. A rota passa
    // kind="live"; portanto a decisão do player deve respeitar o kind explícito
    // e não depender só do padrão Xtream /live/... .ts.
    const isLive = kind === "live" || /\/live\/[^/]+\/[^/]+\//i.test(workingSrc);
    const liveHostProfile = isLive ? getHostProfile(hostOf(workingSrc)) : {};
    // Early guard: se este host já foi marcado como incompatível com Web Desktop
    // para LIVE, não perde tempo tentando reproduzir — mostra aviso imediato.
    // O APK/TV usa ExoPlayer nativo (shouldUseNativePlayer) e ignora este guard.
    if (isLive && !nativeRuntimeRef.current && liveHostProfile.webIncompatibleLive) {
      pushDbg(`ETAPA 0 host ${hostOf(workingSrc)} marcado webIncompatibleLive — abortando somente navegador real`);
      setError(
        "Este provedor não permite reprodução de canais AO VIVO no navegador. " +
        "Filmes e séries funcionam normalmente. Para assistir aos canais, use o app Android/TV."
      );
      return;
    }


    const sourceIsHls = isHlsUrl(workingSrc);
    const sourceIsTs = isTsUrl(workingSrc);
    const sourceFormat = sourceIsHls ? "hls" : sourceIsTs ? "ts" : "auto";
    // No web desktop, manter HLS-first para `.ts` ao vivo (canais Xtream):
    // o provedor quase sempre expõe variante .m3u8 na mesma rota, e mpegts.js
    // direto falha em muitos painéis (CORS / codecs). Só pulamos HLS para
    // containers progressivos (mp4/mkv) ou quando o usuário forçou na Settings.
    // CRÍTICO: se o src original já é .m3u8, NUNCA pular HLS — disableHlsConversion
    // só bloqueia inventar .m3u8 a partir de .ts, jamais o contrário.
    const skipHls =
      compat.streamFormat === "ts" ||
      compat.streamFormat === "mp4" ||
      (isLive && !!liveHostProfile.disableHlsConversion && !sourceIsHls) ||
      (compat.streamFormat == null && (auto === "mp4" || auto === "mkv"));

    const hlsCandidate = skipHls ? null : toHlsCandidate(workingSrc, kind);
    // VOD (filmes/séries) deve ser conservador: usa exatamente a URL resolvida
    // pelo catálogo/API. Inventar extensões alternativas (.m4v/.mkv/.m3u8)
    // fazia o player abandonar um MP4 válido em navegadores lentos/headless e
    // parecia que filmes/séries também tinham quebrado.
    const vodCandidates: string[] = [workingSrc];
    const directCandidates = isLive ? liveDirectCandidates(workingSrc) : vodCandidates;
    // Perfil do host: alguns painéis (ex.: athra.sbs) bloqueiam IP de datacenter,
    // então o proxy /api/stream toma 403 em LIVE. Quando o perfil pede bypass,
    // priorizamos a URL direta (que sai do IP residencial do APK) e mantemos o
    // proxy só como último recurso pra não regredir contexto web.
    const liveBypassProxy = !!(liveHostProfile.bypassProxyForLive || liveHostProfile.disableProxy);
    // LIVE/Web: quando o host tem httpsPort no perfil (ex.: flipex.pro:25463)
    // E a página está em HTTPS, prepende candidatos `https://host:port/...` que
    // pulam totalmente o proxy. Resolve o caso comum do CDN do provedor
    // bloquear IPs do Cloudflare Worker.
    const pageIsHttps = typeof window !== "undefined" && window.location?.protocol === "https:";
    const liveCandidatePair = (url: string) => {
      const proxy = proxiedX(url, kind);
      // Web Desktop em HTTPS não consegue abrir http:// direto (mixed content).
      // Mesmo que o host esteja marcado como bypass para APK/TV, no browser o
      // proxy precisa vir antes para os candidatos HTTP; HTTPS direto continua
      // tendo prioridade quando existir (httpsPortCandidates acima).
      if (pageIsHttps && /^http:\/\//i.test(url)) return [proxy, url];
      return liveBypassProxy ? [url, proxy] : [proxy, url];
    };
    const httpsPortCandidates: string[] = (isLive && pageIsHttps && liveHostProfile.httpsPort)
      ? directCandidates
          .map((u) => httpsVariantWithPort(u, liveHostProfile.httpsPort!))
          .filter((u): u is string => !!u)
      : [];
    const orderLiveCandidates = (candidates: string[]) => {
      if (!isLive || liveHostProfile.preferTs) return candidates;
      // Em Web Desktop, prioriza HLS via proxy same-origin. A URL original
      // continua preservada como fallback, mas não deve vir antes do proxy:
      // flipex.pro redireciona para CDN sem CORS e isso fazia o hls.js morrer
      // antes de chegar na variante funcional /api/stream m3u8.
      const decode = (u: string) => { try { return decodeURIComponent(u); } catch { return u; } };
      const rank = (u: string) => {
        const d = decode(u);
        const hlsRank = isHlsUrl(d) ? 0 : 1;
        const proxyRank = /^\/api\/stream\?/i.test(u) ? 0 : 1;
        return hlsRank * 10 + proxyRank;
      };
      return [...candidates].sort((a, b) => rank(a) - rank(b));
    };

    const playbackCandidates = isVod
      ? vodCandidates.flatMap((url) => {
          const secure = mayUseHttpsVariant ? httpsVariant(url) : null;
          // Por padrão (web): proxy primeiro (https same-origin, sem mixed content).
          // forceDirect inverte: tenta direto antes; forceProxy: só proxy.
          let candidates: (string | null)[];
          if (forceDirect) {
            candidates = [secure, url, proxiedX(url, "vod"), secure ? proxiedX(secure, "vod") : null];
          } else if (forceProxy) {
            candidates = [proxiedX(url, "vod"), secure ? proxiedX(secure, "vod") : null];
          } else {
            candidates = [proxiedX(url, "vod"), secure ? proxiedX(secure, "vod") : null, secure];
          }
          return Array.from(new Set(candidates.filter(Boolean) as string[]));
        })
      : orderLiveCandidates(Array.from(new Set([
          // 1º) HTTPS direto na porta do provedor (sem proxy, sem mixed-content)
          ...httpsPortCandidates,
          // 2º) Demais candidatos LIVE
          ...directCandidates.flatMap(liveCandidatePair),
        ])));
        // ^ LIVE web (sem bypass): proxy primeiro (CORS-safe / mixed-content);
        //   se TODAS as variantes via proxy esgotarem (ex.: flipex.pro 404),
        //   tenta a URL direta como último recurso antes de "FIM sem candidatos"
        //   (ETAPA 8.6). VOD mantém o fluxo próprio acima.

    pushDbg(`ETAPA 4 sourceFormat=${sourceFormat} originalUrlPreserved=${workingSrc === src} profileDisableHlsConversion=${!!liveHostProfile.disableHlsConversion} profilePreferTs=${!!liveHostProfile.preferTs}`);
    pushDbg(`ETAPA 5 isLive=${isLive} isVod=${isVod} sourceIsHls=${sourceIsHls} skipHls=${skipHls} bypassProxy=${liveBypassProxy} httpsPort=${liveHostProfile.httpsPort ?? "-"} httpsDirect=${httpsPortCandidates.length}`);
    pushDbg(`ETAPA 6 hlsCandidate=${hlsCandidate ? maskIptvUrl(hlsCandidate) : "-"}`);
    pushDbg(`ETAPA 7 candidates(${playbackCandidates.length})=${playbackCandidates.slice(0,4).map(maskIptvUrl).join(" | ")}`);


    let hls: Hls | null = null;
    let tsPlayer: MpegTsPlayer | null = null;
    let cancelled = false;
    let vodIdx = 0;
    let triedDirect = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let nativeDirect = false;
    let currentHlsUrl: string | null = null;
    let detachStallListeners: (() => void) | null = null;
    let lastLiveError: string | null = null;
    const triedUrls = new Set<string>();
    const normUrl = (u: string) => { try { return decodeURIComponent(u); } catch { return u; } };


    const clearWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    };

    const destroyTsPlayer = () => {
      clearMpegtsStallWatchdog();
      if (!tsPlayer) return;
      try { tsPlayer.pause(); } catch { /* noop */ }
      try { tsPlayer.unload(); } catch { /* noop */ }
      try { tsPlayer.detachMediaElement(); } catch { /* noop */ }
      try { tsPlayer.destroy(); } catch { /* noop */ }
      tsPlayer = null;
    };

    // Recuperação de erros do mpegts.js em LIVE. Não usamos watchdog por
    // currentTime — isso causa loop "roda-congela-roda-congela" (reload
    // reseta contador, próximo stall reloada de novo). Deixamos o próprio
    // mpegts.js gerenciar buffering; só reagimos a ERROR events.
    let mpegtsRecoverAttempts = 0;
    const MAX_MPEGTS_RECOVER = 2;
    let lastMpegtsUrl: string | null = null;
    const clearMpegtsStallWatchdog = () => { /* noop — mantido p/ compat */ };
    const reloadMpegts = () => {
      if (!lastMpegtsUrl || cancelled) return;
      pushDbg(`mpegts reload url=${maskIptvUrl(lastMpegtsUrl)}`);
      void playMpegTs(lastMpegtsUrl);
    };
    const armMpegtsStallWatchdog = () => { /* noop */ };



    const tryNextVod = () => {
      clearWatchdog();
      if (hls) {
        hls.destroy();
        hls = null;
      }
      destroyTsPlayer();
      vodIdx += 1;
      if (vodIdx < playbackCandidates.length) { pushDbg(`ETAPA 9 tryNext idx=${vodIdx}`); setError(null); playDirect(); }
      else { pushDbg(`ETAPA 10 FIM sem candidatos restantes`); setError(isLive ? (lastLiveError ?? "Não foi possível reproduzir este canal.") : "Não foi possível reproduzir esta mídia."); }
    };

    const armVodWatchdog = () => {
      if (!isVod) return;
      clearWatchdog();
      // VOD progressivo (filmes/séries) pode demorar para ler o índice `moov`
      // no fim de arquivos grandes. Trocar de candidato por timeout antes do
      // erro real do <video> causava regressão: o player abandonava um MP4 bom
      // e pulava para extensões alternativas inexistentes. Para VOD, fallback
      // agora ocorre apenas em erro explícito do elemento de vídeo/HLS.
    };

    const bufferedAhead = () => {
      try {
        const t = video.currentTime;
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= t && video.buffered.end(i) >= t) {
            return video.buffered.end(i) - t;
          }
        }
      } catch {
        // ignore browser buffer read races
      }
      return 0;
    };

    const playMpegTs = async (url: string) => {
      if (!isLive) return false;
      try {
        const probeUrl = probeUrlForCandidate(url);
        if (probeUrl) {
          try {
            pushDbg(`PROBE url=${maskIptvUrl(probeUrl)}`);
            const probeRes = await fetch(probeUrl, { cache: "no-store" });
            const probe = (await probeRes.json()) as StreamProbeResult;
            pushDbg(`PROBE status=${probe.status} ok=${probe.ok} ct=${probe.contentType || "-"} host=${probe.finalUrlHost || "-"}${probe.reason ? ` reason=${probe.reason}` : ""}`);
            if (!probe.ok) {
              const msg = messageForProbeStatus(probe.status);
              lastLiveError = msg;
              setError(msg);
              if (!cancelled) tryNextVod();
              return true;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            pushDbg(`PROBE erro=${msg.slice(0, 160)}`);
          }
        }
        const mpegts = await loadMpegts();
        if (cancelled || !mpegts.isSupported()) return false;
        destroyTsPlayer();
        video.pause();
        video.removeAttribute("src");
        video.load();
        // mpegts.js exige URL absoluta no FetchStreamLoader (com worker,
        // URLs relativas falham com NetworkError/Exception imediato no web).
        const absUrl = (() => {
          try {
            return typeof window !== "undefined"
              ? new URL(url, window.location.origin).toString()
              : url;
          } catch {
            return url;
          }
        })();
        lastMpegtsUrl = url;
        tsPlayer = mpegts.createPlayer(
          { type: "mpegts", isLive: true, url: absUrl },
          {
            isLive: true,
            enableWorker: false,
            // Config original que abria mais canais. Ajustes de stash/latência
            // aumentaram compatibilidade contra travas em alguns hosts, mas
            // impediram a abertura de outros no APK/WebView.
            enableStashBuffer: false,
            liveBufferLatencyChasing: true,
            liveBufferLatencyMaxLatency: 6,
            liveBufferLatencyMinRemain: 1,
          },
        );
        tsPlayer.on(mpegts.Events.ERROR, (errType: unknown, errDetail: unknown) => {
          pushDbg(`mpegts ERROR type=${String(errType)} detail=${String(errDetail)}`);
          if (cancelled) return;
          // Stream ao vivo pode ter erros transitórios de rede/CDN. Tenta
          // reconectar preservando o player antes de desistir para o próximo
          // candidato (que muitas vezes nem existe pra LIVE).
          if (isLive && mpegtsRecoverAttempts < MAX_MPEGTS_RECOVER) {
            mpegtsRecoverAttempts += 1;
            pushDbg(`mpegts recover attempt=${mpegtsRecoverAttempts}`);
            try { reloadMpegts(); return; } catch { /* fallthrough */ }
          }
          tryNextVod();
        });
        tsPlayer.attachMediaElement(video);
        tsPlayer.load();
        const playPromise = tsPlayer.play();
        if (playPromise && typeof playPromise.then === "function") {
          playPromise.then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
        } else {
          void video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
        }
        armMpegtsStallWatchdog();
        return true;
      } catch {
        return false;
      }
    };

    const playDirect = () => {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      destroyTsPlayer();
      triedDirect = true;
      // Pula candidates já tentados (HLS pré-flight ou loop após fatal).
      while (vodIdx < playbackCandidates.length) {
        const c = playbackCandidates[vodIdx];
        if (c && triedUrls.has(normUrl(c))) {
          pushDbg(`SKIP candidate idx=${vodIdx} já tentado`);
          vodIdx += 1;
          continue;
        }
        break;
      }
      if (vodIdx >= playbackCandidates.length) {
        pushDbg(`ETAPA 10 FIM sem candidatos restantes`);
        setError(isLive ? (lastLiveError ?? "Não foi possível reproduzir este canal.") : "Não foi possível reproduzir esta mídia.");
        return;
      }
      const url = playbackCandidates[vodIdx] ?? (nativeDirect ? workingSrc : proxiedX(workingSrc, kind));
      triedUrls.add(normUrl(url));
      const isProxied = /^\/api\/stream\?/i.test(url);
      // ETAPA 8.6: LIVE caiu no candidato direto (fora do proxy) — útil pra
      // diagnosticar painéis que bloqueiam o IP do datacenter do proxy.
      if (isLive && !isProxied) {
        pushDbg(`ETAPA 8.6 fallback direto sem proxy host=${hostOf(url) ?? "?"}`);
        // Aprendizado: chegamos a um candidato direto LIVE, logo todos os
        // proxiados anteriores falharam (404/5xx). Memoriza pra próxima sessão
        // já priorizar direto pra esse host e não desperdiçar tentativas.
        try {
          const h = hostOf(url);
          if (h && !getHostProfile(h).bypassProxyForLive) {
            updateHostProfile(h, { bypassProxyForLive: true });
            pushDbg(`ETAPA 8.6 host ${h} marcado bypassProxyForLive=true`);
          }
        } catch { /* noop */ }
        // Mixed content: página https + stream http é silenciosamente bloqueada
        // pelo browser. Registramos pra debug; o erro do <video> ainda dispara
        // o tryNextVod normalmente.
        try {
          if (typeof location !== "undefined" && location.protocol === "https:" && /^http:\/\//i.test(url)) {
            pushDbg(`ETAPA 8.6 WARN mixed-content (https page + http stream) — pode ser bloqueado pelo browser`);
          }
        } catch { /* noop */ }
      }
      pushDbg(`ETAPA 8 playDirect idx=${vodIdx} url=${maskIptvUrl(url)}`);
      const decodedUrl = normUrl(url);

      if (/\.m3u8(\?|&|$)/i.test(decodedUrl)) {
        attachHls(url);
        return;
      }
      // LIVE MPEG-TS de M3U pode não ter extensão visível (ex.: /user/pass/id)
      // ou estar dentro do /api/stream?u=... sem .ts no path. Nesses casos o
      // proxy devolve video/mp2t, mas <video> sozinho não demuxa TS no Chrome;
      // precisa passar pelo mpegts.js. VOD continua intocado.
      if (isLive || /\.ts(\?|&|$)/i.test(decodedUrl)) {
        void playMpegTs(url).then((handled) => {
          if (!handled && !cancelled) {
            video.pause();
            video.currentTime = 0;
            video.src = url;
            video.load();
            video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
          }
        });
        return;
      }
      video.pause();
      video.currentTime = 0;
      video.src = url;
      video.load();
      armVodWatchdog();
      video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
    };

    let nativeFallbackStarted = false;
    let apkLiveFreezeTimer: ReturnType<typeof setTimeout> | null = null;
    let apkLiveProgressTimer: ReturnType<typeof setInterval> | null = null;
    let apkLiveLastTime = 0;
    let apkLiveStillTicks = 0;
    let apkLiveHasPlayed = false;
    const apkLiveFreezeEvents: number[] = [];
    const clearApkLiveFreezeTimer = () => {
      if (apkLiveFreezeTimer) clearTimeout(apkLiveFreezeTimer);
      apkLiveFreezeTimer = null;
    };
    const clearApkLiveProgressTimer = () => {
      if (apkLiveProgressTimer) clearInterval(apkLiveProgressTimer);
      apkLiveProgressTimer = null;
      apkLiveStillTicks = 0;
    };
    const fallbackToNativeFromApkFreeze = async (reason: string) => {
      if (nativeFallbackStarted || cancelled || !isLive || !nativeRuntimeRef.current || shouldUseNativePlayer) return;
      nativeFallbackStarted = true;
      clearApkLiveFreezeTimer();
      clearApkLiveProgressTimer();
      pushDbg(`APK LIVE freeze fallback -> ExoPlayer reason=${reason}`);
      detachStallListeners?.();
      if (hls) {
        try { hls.destroy(); } catch { /* noop */ }
        hls = null;
      }
      destroyTsPlayer();
      try { video.pause(); } catch { /* noop */ }
      try { video.removeAttribute("src"); video.load(); } catch { /* noop */ }
      const ok = await openNative();
      pushDbg(`APK LIVE freeze fallback openNative=${ok}`);
      if (cancelled) {
        if (ok) void stopNative().catch(() => undefined);
        return;
      }
      if (ok) {
        nativeOpenedRef.current = true;
        setPlayerMode("native");
      } else {
        nativeFallbackStarted = false;
        setPlayerMode("web");
        showStreamDiagnostic("Canal LIVE travou no player interno do APK e o ExoPlayer não abriu. Veja o diagnóstico abaixo.");
      }
    };
    const registerApkLiveFreezeSignal = (reason: string) => {
      if (cancelled || nativeFallbackStarted || !isLive || !nativeRuntimeRef.current || shouldUseNativePlayer) return;
      if (!apkLiveHasPlayed) return;
      const now = Date.now();
      apkLiveFreezeEvents.push(now);
      while (apkLiveFreezeEvents.length && now - apkLiveFreezeEvents[0] > 90_000) {
        apkLiveFreezeEvents.shift();
      }
      pushDbg(`APK LIVE freeze signal=${reason} count=${apkLiveFreezeEvents.length} ready=${video.readyState} net=${video.networkState} ahead=${bufferedAhead().toFixed(2)}`);
      if (apkLiveFreezeEvents.length >= 2) {
        void fallbackToNativeFromApkFreeze(`${reason}:repeated`);
        return;
      }
      if (!apkLiveFreezeTimer) {
        apkLiveFreezeTimer = setTimeout(() => {
          apkLiveFreezeTimer = null;
          if (cancelled || nativeFallbackStarted || !isLive || !nativeRuntimeRef.current || shouldUseNativePlayer) return;
          const stuck = !video.paused && !video.ended && (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || bufferedAhead() < 1);
          if (stuck) void fallbackToNativeFromApkFreeze(`${reason}:stuck`);
        }, 4_000);
      }
    };
    const startApkLiveProgressWatch = () => {
      if (apkLiveProgressTimer || !isLive || !nativeRuntimeRef.current || shouldUseNativePlayer || nativeFallbackStarted) return;
      apkLiveLastTime = video.currentTime || 0;
      apkLiveStillTicks = 0;
      apkLiveProgressTimer = setInterval(() => {
        if (cancelled || nativeFallbackStarted || !isLive || !nativeRuntimeRef.current || shouldUseNativePlayer) {
          clearApkLiveProgressTimer();
          return;
        }
        if (video.paused || video.ended) {
          apkLiveLastTime = video.currentTime || 0;
          apkLiveStillTicks = 0;
          return;
        }
        const nowTime = video.currentTime || 0;
        if (Math.abs(nowTime - apkLiveLastTime) > 0.25) {
          apkLiveLastTime = nowTime;
          apkLiveStillTicks = 0;
          return;
        }
        apkLiveStillTicks += 1;
        pushDbg(`APK LIVE progress stuck tick=${apkLiveStillTicks} t=${nowTime.toFixed(2)} ready=${video.readyState} net=${video.networkState} ahead=${bufferedAhead().toFixed(2)}`);
        if (apkLiveStillTicks >= 2) {
          const actuallyStuck = video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || bufferedAhead() < 1;
          if (actuallyStuck) void fallbackToNativeFromApkFreeze("silent-currentTime");
          else apkLiveStillTicks = 0;
        }
      }, 3_000);
    };

    const onVideoError = () => {
      const mediaErr = video.error;
      pushDbg(`<video> error code=${mediaErr?.code ?? "?"} msg=${mediaErr?.message ?? "-"} netState=${video.networkState} readyState=${video.readyState}`);
      if (cancelled || hls) return;
      tryNextVod();
    };
    const onVideoReady = () => {
      clearWatchdog();
      clearApkLiveFreezeTimer();
    };
    const onPlaying = () => {
      apkLiveHasPlayed = true;
      clearWatchdog();
      clearApkLiveFreezeTimer();
      startApkLiveProgressWatch();
      setCanManualPlay(false);
    };
    const onWaitingGeneric = () => registerApkLiveFreezeSignal("waiting");
    const onStalledGeneric = () => registerApkLiveFreezeSignal("stalled");
    video.addEventListener("error", onVideoError);
    video.addEventListener("loadeddata", onVideoReady);
    video.addEventListener("canplay", onVideoReady);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaitingGeneric);
    video.addEventListener("stalled", onStalledGeneric);

    const attachHls = (url: string) => {
      currentHlsUrl = url;
      triedUrls.add(normUrl(url));
      pushDbg(`attachHls url=${maskIptvUrl(url)}`);

      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // Config estável (revertida da versão agressiva que travava abertura).
          // Live: buffer com margem contra jitter (era 30s — muito enxuto,
          // qualquer glitch de rede virava rebuffering). 45s + liveSync 4
          // mantém latência aceitável (~12s do edge) sem travar abertura.
          // VOD: caps reduzidos para não estourar RAM em TV Box (1-2GB).
          backBufferLength: isLive ? 15 : 30,
          maxBufferLength: isLive ? 45 : 60,
          maxMaxBufferLength: isLive ? 90 : 180,
          maxBufferSize: isLive ? 90 * 1000 * 1000 : 90 * 1000 * 1000,
          maxBufferHole: isLive ? 1.5 : 0.5,
          highBufferWatchdogPeriod: isLive ? 2 : 3,
          nudgeMaxRetry: 6,
          nudgeOffset: 0.1,
          fragLoadingMaxRetry: 8,
          manifestLoadingMaxRetry: 6,
          levelLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 500,
          fragLoadingTimeOut: 20_000,
          manifestLoadingTimeOut: 15_000,
          levelLoadingTimeOut: 15_000,
          // Fica um pouco mais atrás do edge que antes (3→4) pra ter colchão
          // contra jitter, e re-sincroniza (12) antes de acumular atraso.
          liveSyncDurationCount: 4,
          liveMaxLatencyDurationCount: 12,
          // Live: começa pelo nível mais baixo e sem teste de banda — muitos
          // servidores IPTV não respondem ao probe de bandwidth do hls.js
          // (era o que travava a abertura dos canais no APK).
          startLevel: isLive ? 0 : -1,
          testBandwidth: !isLive,
          startFragPrefetch: true,
          abrEwmaDefaultEstimate: 1_000_000,
          abrBandWidthFactor: 0.8,
          abrBandWidthUpFactor: 0.7,
          maxStarvationDelay: 4,
          maxLoadingDelay: 4,
          capLevelToPlayerSize: true,
        });
        hls.loadSource(url);
        hls.attachMedia(video);

        // Dispara play() assim que o manifest é parseado — não espera o
        // autoPlay do browser engatar, reduz delay até primeiro frame.
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
        });

        let netRetries = 0;
        const MAX_NET_RETRIES = 5;
        let mediaRetries = 0;
        const MAX_MEDIA_RETRIES = 3;

        // Stall watchdog para LIVE: recuperação rápida, sem destruir/recarregar o
        // player. Se acabou o buffer, religamos o loader; se ainda tem buffer,
        // só forçamos play(). Isso corta travadas sem voltar ao bug de reload.
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        const clearStall = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };

        // Fallback automático de qualidade: no primeiro sinal de travada em
        // live já fixa no nível mais baixo. É melhor perder qualidade por um
        // tempo do que deixar o canal parar repetidamente.
        const stallTimestamps: number[] = [];
        let lockedLow = false;
        let unlockTimer: ReturnType<typeof setTimeout> | null = null;
        const lockLowQuality = () => {
          if (!hls || lockedLow) return;
          lockedLow = true;
          try {
            hls.nextLevel = 0;
            hls.loadLevel = 0;
            hls.autoLevelCapping = 0;
          } catch { /* noop */ }
          if (unlockTimer) clearTimeout(unlockTimer);
          unlockTimer = setTimeout(() => {
            if (!hls) return;
            try {
              hls.autoLevelCapping = -1;
              hls.nextLevel = -1;
              hls.loadLevel = -1;
            } catch { /* noop */ }
            lockedLow = false;
            stallTimestamps.length = 0;
          }, 120_000);
        };
        const registerStall = () => {
          if (!isLive) return;
          const now = Date.now();
          stallTimestamps.push(now);
          // mantém só os últimos 45s
          while (stallTimestamps.length && now - stallTimestamps[0] > 45_000) {
            stallTimestamps.shift();
          }
          lockLowQuality();
        };

        let manifestReady = false;
        hls.on(Hls.Events.MANIFEST_PARSED, () => { manifestReady = true; });

        const recoverLiveStall = () => {
          if (!isLive || cancelled || !manifestReady) return;
          clearStall();
          stallTimer = setTimeout(() => {
            if (cancelled || !hls) return;
            const ahead = bufferedAhead();
            if (ahead < 0.75) {
              try { hls.startLoad(); } catch { /* noop */ }
            }
            void video.play().catch(() => undefined);
            if (!cancelled && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) recoverLiveStall();
          }, 3_000);
        };
        const onWaiting = () => { registerStall(); recoverLiveStall(); };
        const onResumed = () => clearStall();
        video.addEventListener("waiting", onWaiting);
        video.addEventListener("playing", onResumed);

        // Page visibility: quando a aba/tela perde foco, paramos o download
        // (hls.stopLoad) para liberar memória — buffer atual mantém o playback
        // se voltar logo. Retomamos no foco. Live: só pausa loader se estiver
        // explicitamente pausado (canal em background continua "ao vivo").
        const onVisibility = () => {
          if (!hls) return;
          const hidden = document.visibilityState === "hidden";
          try {
            if (hidden) {
              if (!isLive || video.paused) hls.stopLoad();
            } else {
              hls.startLoad();
            }
          } catch { /* noop */ }
        };
        document.addEventListener("visibilitychange", onVisibility);

        detachStallListeners = () => {
          clearStall();
          if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
          video.removeEventListener("waiting", onWaiting);
          video.removeEventListener("playing", onResumed);
          document.removeEventListener("visibilitychange", onVisibility);
        };

        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (cancelled) return;
          if (data.fatal) pushDbg(`hls FATAL type=${data.type} details=${data.details} http=${(data as { response?: { code?: number } }).response?.code ?? "-"} url=${(data as { url?: string }).url ? maskIptvUrl((data as { url?: string }).url!) : "-"}`);
          if (!data.fatal) {
            if (isLive && (
              data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR ||
              data.details === Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE ||
              data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT ||
              data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT
            )) {
              registerStall();
              recoverLiveStall();
            }
            return;
          }
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (isLive) {
                // Fail-fast quando upstream/proxy devolve 4xx (404/424/403...):
                // a variante .m3u8 não existe ou o proxy não conseguiu alcançar
                // o servidor. Sem retry — caímos direto pro fallback (.ts via
                // mpegts.js), que é o que a maioria dos painéis Xtream serve.
                const httpCode = (data as { response?: { code?: number } }).response?.code ?? 0;
                const hardFail = httpCode >= 400 && httpCode < 500;
                const isAuthFail = httpCode === 401 || httpCode === 403;
                // 404/410 no .m3u8 = host não fornece HLS. Memoriza para
                // próximos canais desse provedor pularem a conversão.
                if ((httpCode === 404 || httpCode === 410) && hlsCandidate) {
                  const h = hostOf(workingSrc);
                  if (h) rememberHlsUnsupported(h);
                }
                if (hardFail || netRetries++ >= MAX_NET_RETRIES) {
                  if (!hardFail && nativeDirect && hlsCandidate && currentHlsUrl === hlsCandidate) {
                    detachStallListeners?.();
                    hls?.destroy();
                    hls = null;
                    attachHls(proxiedX(hlsCandidate, kind));
                    return;
                  }
                  detachStallListeners?.();
                  hls?.destroy();
                  hls = null;
                  if (isAuthFail) {
                    setError("Servidor recusou a reprodução: usuário sem autorização, conta expirada, limite de conexões ou URL inválida.");
                    return;
                  }
                  // FIX: se o candidate atual é exatamente a URL HLS que falhou,
                  // avança vodIdx para não reentrar em attachHls com a mesma URL.
                  const advanceIfHlsMatches = () => {
                    const cur = playbackCandidates[vodIdx];
                    if (!cur || !currentHlsUrl) return;
                    const norm = (u: string) => { try { return decodeURIComponent(u); } catch { return u; } };
                    if (norm(cur) === norm(currentHlsUrl) || /\.m3u8(\?|&|$)/i.test(norm(cur))) {
                      vodIdx += 1;
                      pushDbg(`ETAPA 8.5 hls→next idx=${vodIdx} (advance from failed .m3u8)`);
                    }
                  };
                  advanceIfHlsMatches();
                  if (vodIdx >= playbackCandidates.length) {
                    pushDbg(`ETAPA 10 FIM sem candidatos restantes (hls fatal http=${httpCode})`);
                    // Padrão típico de host incompatível com Web: proxy 404/424
                    // (CDN bloqueia IP edge) + direto http=0 (CORS ausente no CDN).
                    // Marca o host para futuras sessões pularem o loop de tentativas.
                    if (isLive && triedDirect) {
                      const h = hostOf(workingSrc);
                      if (h) {
                        rememberWebIncompatibleLive(h);
                        pushDbg(`ETAPA 10 host ${h} marcado webIncompatibleLive`);
                      }
                      setError(
                        "Este provedor não permite reprodução de canais AO VIVO no navegador. " +
                        "Filmes e séries funcionam normalmente. Para assistir aos canais, use o app Android/TV."
                      );
                    } else {
                      setError("Não foi possível reproduzir este canal. A URL do stream foi recusada pelo servidor.");
                    }
                    return;
                  }

                  triedDirect = true;
                  playDirect();
                  return;
                }

                const delay = Math.min(500 * 2 ** (netRetries - 1), 8000);
                setTimeout(() => {
                  if (cancelled) return;
                  hls?.startLoad();
                }, delay);
              } else {
                detachStallListeners?.();
                tryNextVod();
              }
              return;
            case Hls.ErrorTypes.MEDIA_ERROR:
              if (isLive) {
                if (mediaRetries++ >= MAX_MEDIA_RETRIES) {
                  detachStallListeners?.();
                  hls?.destroy();
                  hls = null;
                  // MEDIA_ERROR também precisa avançar de candidato. Antes, se
                  // uma variante HLS direta (.m3u8) falhasse depois de já termos
                  // tentado candidatos diretos/proxy anteriores, o player parava
                  // aqui e nunca chegava ao próximo fallback (ex.: .m3u8 via
                  // /api/stream). Isso quebrava LIVE no Web Desktop.
                  const cur = playbackCandidates[vodIdx];
                  if (cur && currentHlsUrl) {
                    const norm = (u: string) => { try { return decodeURIComponent(u); } catch { return u; } };
                    if (norm(cur) === norm(currentHlsUrl) || /\.m3u8(\?|&|$)/i.test(norm(cur))) {
                      vodIdx += 1;
                      pushDbg(`ETAPA 8.5 hls-media→next idx=${vodIdx} (advance from failed .m3u8)`);
                    }
                  }
                  if (vodIdx < playbackCandidates.length) playDirect();
                  else setError("Erro de mídia no canal. Tente novamente.");
                  return;
                }
                hls?.recoverMediaError();
              } else {
                detachStallListeners?.();
                tryNextVod();
              }
              return;
            default:
              detachStallListeners?.();
              hls?.destroy();
              hls = null;
              if (!triedDirect) playDirect();
              else setError("Não foi possível reproduzir este canal.");
          }
        });

      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.play().then(() => setCanManualPlay(false)).catch(() => setCanManualPlay(true));
      } else {
        playDirect();
      }
    };

    void isNativeApp().then((native) => {
      if (cancelled) return;
      nativeDirect = native;
       if (native && forceDirect) {
        // APK/TV com transporte direto forçado: tenta direto primeiro e mantém
        // proxy como último recurso. No modo automático usamos proxy primeiro
        // para evitar bloqueio de CORS/mixed-content no WebView do APK.
        playbackCandidates.splice(0, playbackCandidates.length, ...orderLiveCandidates(directCandidates.flatMap((url) => {
          const secure = httpsVariant(url);
          const list = [url, secure, proxiedX(url, kind)];
          return Array.from(new Set(list.filter(Boolean) as string[]));
        })));
      } else if (native && forceProxy) {
        playbackCandidates.splice(0, playbackCandidates.length, ...orderLiveCandidates(directCandidates.map((u) => proxiedX(u, kind))));
      }
      // CRÍTICO: sempre iniciar pelo ciclo único de candidates. O bootstrap HLS
      // antigo chamava attachHls(hlsCandidate) por fora da lista; quando falhava,
      // o índice avançava e pulava o candidate correto via proxy. Isso quebrava
      // LIVE Web Desktop, especialmente em páginas HTTPS com host em bypass.
      playDirect();
    });

    return () => {
      cancelled = true;
      clearWatchdog();
      clearApkLiveFreezeTimer();
      clearApkLiveProgressTimer();
      detachStallListeners?.();
      video.removeEventListener("error", onVideoError);
      video.removeEventListener("loadeddata", onVideoReady);
      video.removeEventListener("canplay", onVideoReady);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaitingGeneric);
      video.removeEventListener("stalled", onStalledGeneric);
      if (hls) hls.destroy();
      destroyTsPlayer();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, kind, playerMode, holdNativeDebug, pushDbg, openNative, shouldUseNativePlayer, showStreamDiagnostic]);

  // No APK Android, força paisagem ao entrar em tela cheia. Ao sair, NÃO
  // desbloqueia — o APK inteiro precisa permanecer em landscape (manifest +
  // ScreenOrientation.lock no boot). Desbloquear aqui fazia o app voltar
  // para portrait quando o usuário fechava o player no celular.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onFsChange = () => {
      const isFs = !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
      // Sempre re-aplica landscape, tanto entrando quanto saindo do fullscreen.
      void lockLandscape();
      void isFs; // mantemos o cálculo para clareza/log futuros
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    video.addEventListener("webkitbeginfullscreen", lockLandscape as EventListener);
    video.addEventListener("webkitendfullscreen", lockLandscape as EventListener);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      video.removeEventListener("webkitbeginfullscreen", lockLandscape as EventListener);
      video.removeEventListener("webkitendfullscreen", lockLandscape as EventListener);
      // Cleanup: re-aplica landscape em vez de desbloquear.
      void lockLandscape();
    };
  }, []);

  // Continue assistindo: ao carregar metadata, faz seek para a posição salva
  // (apenas VOD/série, nunca live). Reporta progresso a cada 5s, ao pausar e
  // ao desmontar para o store de histórico.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || kind === "live") return;

    let hasSeeked = false;
    // Mantemos o último (pos,dur) conhecido para conseguir salvar progresso
    // no cleanup, mesmo que outro effect já tenha resetado o <video> antes.
    let lastPos = 0;
    let lastDur = 0;

    const seekToInitial = () => {
      if (hasSeeked) return;
      const pos = initialPositionRef.current;
      const dur = video.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      if (!pos) { hasSeeked = true; return; }
      if (pos / dur > 0.95) { hasSeeked = true; return; }
      if (pos < 10) { hasSeeked = true; return; }
      try {
        video.currentTime = Math.min(pos, dur - 5);
      } catch {
        /* ignore */
      }
      hasSeeked = true;
    };

    const captureProgress = () => {
      const pos = video.currentTime;
      const dur = video.duration;
      if (Number.isFinite(pos) && pos > 0) lastPos = pos;
      if (Number.isFinite(dur) && dur > 0) lastDur = dur;
    };

    const reportProgress = () => {
      captureProgress();
      if (lastDur <= 0) return;
      onProgressRef.current?.(lastPos, lastDur);
      if (mediaId && mediaKind) {
        // store.updateProgress já tem debounce interno (4s / 5s de delta),
        // então pode ser chamado livremente em timeupdate/intervalo.
        try { store.updateProgress(mediaKind, mediaId, lastPos, lastDur); } catch { /* noop */ }
      }
    };


    let tickId: ReturnType<typeof setInterval> | null = null;
    const startTicking = () => {
      if (tickId) return;
      tickId = setInterval(reportProgress, 5000);
    };
    const stopTicking = () => {
      if (tickId) clearInterval(tickId);
      tickId = null;
    };

    const onLoadedMeta = () => seekToInitial();
    const onCanPlay = () => seekToInitial();
    const onPlay = () => startTicking();
    const onTimeUpdate = () => captureProgress();
    const onPause = () => {
      stopTicking();
      reportProgress();
    };
    const onEnded = () => {
      stopTicking();
      const dur = video.duration;
      if (Number.isFinite(dur) && dur > 0) {
        onProgressRef.current?.(dur, dur);
        if (mediaId && mediaKind) {
          try { store.updateProgress(mediaKind, mediaId, dur, dur); } catch { /* noop */ }
        }
      }
    };

    video.addEventListener("loadedmetadata", onLoadedMeta);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("play", onPlay);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);

    return () => {
      stopTicking();
      // Salva usando os últimos valores capturados — resiliente caso o effect
      // de playback já tenha chamado video.load() antes deste cleanup.
      if (lastDur > 0) {
        onProgressRef.current?.(lastPos, lastDur);
        if (mediaId && mediaKind) {
          try { store.updateProgress(mediaKind, mediaId, lastPos, lastDur); } catch { /* noop */ }
        }
      }
      video.removeEventListener("loadedmetadata", onLoadedMeta);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [src, kind, mediaId, mediaKind]);

  // onReady: chama uma única vez no primeiro `canplay` do <video> em modo web,
  // entregando um handle com seekTo. Usado por consumidores para oferecer
  // toast "Continuar de onde parou?" sem mexer na lógica interna do player.
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  useEffect(() => {
    if (playerMode !== "web") return;
    const video = videoRef.current;
    if (!video) return;
    let fired = false;
    const handle: VideoPlayerHandle = {
      seekTo: (seconds: number) => {
        try {
          const dur = video.duration;
          if (!Number.isFinite(seconds) || seconds < 0) return;
          const target = Number.isFinite(dur) && dur > 0 ? Math.min(seconds, dur - 2) : seconds;
          video.currentTime = target;
        } catch { /* ignore */ }
      },
    };
    const onCanPlayOnce = () => {
      if (fired) return;
      fired = true;
      try { onReadyRef.current?.(handle); } catch { /* noop */ }
    };
    video.addEventListener("canplay", onCanPlayOnce);
    return () => video.removeEventListener("canplay", onCanPlayOnce);
  }, [src, playerMode]);

  // Auto-hide dos controles nativos: aparece só ao mover o mouse / tocar a tela,
  // some após 2.5s de inatividade. Evita que o player abra já com a barra
  // nativa do navegador visível em cima do vídeo.
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealNativeControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => setControlsVisible(false), 2500);
  }, []);
  useEffect(() => () => {
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
  }, []);

  // ===== Picture-in-Picture (Web API) =====
  const pipSupported = typeof document !== "undefined" && !!document.pictureInPictureEnabled;
  const [pipActive, setPipActive] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !pipSupported) return;
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    v.addEventListener("enterpictureinpicture", onEnter);
    v.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      v.removeEventListener("enterpictureinpicture", onEnter);
      v.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, [pipSupported]);
  const togglePip = useCallback(async () => {
    if (!pipSupported) {
      toast("Picture-in-Picture não suportado neste dispositivo");
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement === v) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      toast("Não foi possível ativar o Picture-in-Picture");
    }
  }, [pipSupported]);

  return (
    <div
      className="relative h-full w-full bg-player"
      onMouseMove={revealNativeControls}
      onMouseEnter={revealNativeControls}
      onTouchStart={revealNativeControls}
      onClick={revealNativeControls}
    >
      <video
        ref={videoRef}
        poster={poster}
        controls={false}
        autoPlay
        playsInline
        style={{
          ['--cue-scale' as never]: settings.subtitleScale,
          filter: 'saturate(1.15) contrast(1.08) brightness(1.02)',
        }}
        className={videoClass}
        hidden={playerMode === "native"}
      />

      {playerMode === "native" && !error && (
        <div className="absolute inset-0 flex flex-col bg-player text-foreground">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-xs opacity-80">Player nativo (ExoPlayer) — diagnóstico</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  try { void navigator.clipboard?.writeText(dbgLines.join("\n")); } catch { /* noop */ }
                }}
                className="rounded bg-white/10 px-2 py-1 text-[10px] uppercase tracking-wide"
              >
                Copiar
              </button>
              <button
                type="button"
                onClick={() => { void openNative(); }}
                className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground"
              >
                ▶ Abrir
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto px-3 py-2 font-mono text-[10px] leading-tight whitespace-pre-wrap">
            {dbgLines.length === 0 ? "(sem logs)" : dbgLines.join("\n")}
          </div>
        </div>
      )}

      {(error || debugPanelOpen) && (
        <div className="absolute inset-0 flex flex-col bg-black/90 text-white">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-sm font-semibold text-destructive">{error ?? "[STREAM DEBUG] Diagnóstico LIVE"}</span>
            <div className="flex gap-2">
              {holdNativeDebug && (
                <button
                  type="button"
                  onClick={() => { void launchNativeFromDebug(); }}
                  className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground"
                >
                  Abrir ExoPlayer
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  try {
                    void navigator.clipboard?.writeText(dbgLines.join("\n"));
                  } catch { /* noop */ }
                }}
                className="rounded bg-white/10 px-2 py-1 text-[10px] uppercase tracking-wide"
              >
                Copiar
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto px-3 py-2 font-mono text-[10px] leading-tight whitespace-pre-wrap">
            {dbgLines.length === 0 ? "(sem logs)" : dbgLines.join("\n")}
          </div>
        </div>
      )}
      {canManualPlay && !error && playerMode === "web" && (
        <button
          type="button"
          onClick={() => videoRef.current?.play().then(() => setCanManualPlay(false)).catch(() => undefined)}
          className="absolute inset-0 m-auto h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-glow flex items-center justify-center text-2xl"
          aria-label="Reproduzir"
        >
          ▶
        </button>
      )}
      {playerMode === "web" && !error && (
        <CustomControls
          videoRef={videoRef}
          visible={controlsVisible}
          pipSupported={pipSupported}
          pipActive={pipActive}
          onTogglePip={() => { void togglePip(); }}
          onInteract={revealNativeControls}
          aspectRatio={settings.aspectRatio}
          onCycleAspect={() => {
            const order: AspectRatio[] = ["default", "fill", "stretch", "16:9", "4:3"];
            const i = order.indexOf(settings.aspectRatio);
            const next = order[(i + 1) % order.length];
            store.setAppSettings({ aspectRatio: next });
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Custom controls bar — substitui os controles nativos do <video>. Motivos:
// (1) uniformidade visual entre Android/APK/desktop, (2) navegável pelo D-pad
// (todos os botões e o slider são elementos focusable padrão), (3) o botão
// de PiP entra na barra e não sobrepõe mais nada. Usar flex simples com
// gap-* garante alinhamento consistente sem posicionamento absoluto solto.
// ============================================================================
function CustomControls({
  videoRef,
  visible,
  pipSupported,
  pipActive,
  onTogglePip,
  onInteract,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  visible: boolean;
  pipSupported: boolean;
  pipActive: boolean;
  onTogglePip: () => void;
  onInteract: () => void;
}) {
  const [paused, setPaused] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onTime = () => { if (!seeking) setCurrent(v.currentTime || 0); };
    const onMeta = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("durationchange", onMeta);
    v.addEventListener("loadedmetadata", onMeta);
    setPaused(v.paused);
    setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    setCurrent(v.currentTime || 0);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("durationchange", onMeta);
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [videoRef, seeking]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, [videoRef]);

  const hasSeek = duration > 0 && Number.isFinite(duration);
  const shown = seeking ? seekValue : current;

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-20 px-3 py-2 sm:px-4 sm:py-3 bg-gradient-to-t from-black/80 via-black/50 to-transparent transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
      onClick={(e) => { e.stopPropagation(); onInteract(); }}
      onMouseMove={onInteract}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={paused ? "Reproduzir" : "Pausar"}
          className="size-10 shrink-0 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur grid place-items-center text-white"
        >
          {paused ? <Play className="size-5" /> : <Pause className="size-5" />}
        </button>

        {hasSeek ? (
          <>
            <span className="text-xs tabular-nums text-white/90 w-12 text-right">{fmtDur(shown)}</span>
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={shown}
              aria-label="Barra de progresso"
              onFocus={onInteract}
              onPointerDown={() => setSeeking(true)}
              onChange={(e) => setSeekValue(parseFloat(e.currentTarget.value))}
              onPointerUp={(e) => {
                const v = videoRef.current;
                const t = parseFloat((e.currentTarget as HTMLInputElement).value);
                if (v && Number.isFinite(t)) v.currentTime = t;
                setSeeking(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const v = videoRef.current;
                  if (!v) return;
                  const delta = e.key === "ArrowRight" ? 10 : -10;
                  const next = Math.min(duration, Math.max(0, (v.currentTime || 0) + delta));
                  v.currentTime = next;
                  setSeekValue(next);
                }
              }}
              className="flex-1 h-1.5 accent-primary cursor-pointer"
            />
            <span className="text-xs tabular-nums text-white/70 w-12">{fmtDur(duration)}</span>
          </>
        ) : (
          <>
            <span className="flex-1 text-xs uppercase tracking-widest text-white/70">Ao vivo</span>
            <span className="inline-flex items-center gap-1 text-xs text-red-400">
              <span className="size-2 rounded-full bg-red-500 animate-pulse" />
              LIVE
            </span>
          </>
        )}

        {pipSupported && (
          <button
            type="button"
            onClick={onTogglePip}
            aria-label={pipActive ? "Sair do Picture-in-Picture" : "Picture-in-Picture"}
            title="Picture-in-Picture"
            className={`size-10 shrink-0 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur grid place-items-center ${pipActive ? "text-primary" : "text-white"}`}
          >
            {pipActive ? <PictureInPicture className="size-5" /> : <PictureInPicture2 className="size-5" />}
          </button>
        )}
      </div>
    </div>
  );
}

function fmtDur(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

