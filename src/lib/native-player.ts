// Ponte com o plugin `capacitor-video-player` (jeep) — usa ExoPlayer no
// Android (via Media3) em overlay fullscreen nativo, fora do WebView.
// Bypassa todas as limitações do MSE/hls.js no WebView:
//  - codecs HEVC/AC3/EAC3 (decoder de hardware)
//  - MPEG-TS sem demux JS
//  - HLS com baixíssima latência
//  - headers customizados (User-Agent estilo XCIPTV)
//
// Em web/desktop esse módulo nunca é importado dinamicamente — o
// VideoPlayer.tsx só chama playNative() quando isNativeApp() === true.

export type NativePlayOptions = {
  url: string;
  userAgent?: string;
  /** Em segundos. Apenas VOD/série. */
  startAtSec?: number;
  /** Callback ao fechar o overlay (Back ou botão sair). */
  onExit?: (positionSec: number) => void;
  /** [DEBUG TEMP] Recebe todos os eventos do plugin (ready/play/ended/erro). */
  onEvent?: (name: string, data: unknown) => void;
};


type CVPModule = typeof import("capacitor-video-player").CapacitorVideoPlayer;

let modPromise: Promise<CVPModule | null> | null = null;

async function loadPlugin(): Promise<CVPModule | null> {
  if (!modPromise) {
    modPromise = import("capacitor-video-player")
      .then((m) => m.CapacitorVideoPlayer as CVPModule)
      .catch(() => null);
  }
  return modPromise;
}

const PLAYER_ID = "fullscreen";
let exitHandle: { remove: () => void } | null = null;
let debugHandles: Array<{ remove: () => void }> = [];


export async function isNativePlayerAvailable(): Promise<boolean> {
  const mod = await loadPlugin();
  return !!mod;
}

export async function playNative(opts: NativePlayOptions): Promise<boolean> {
  const mod = await loadPlugin();
  if (!mod) return false;

  // Limpa listener anterior (cada playNative cria um novo)
  exitHandle?.remove();
  exitHandle = null;

  try {
    // Tenta encerrar player anterior se ainda estiver aberto
    try { await mod.stopAllPlayers(); } catch { /* ignore */ }

    const headers: Record<string, string> = {};
    if (opts.userAgent) headers["User-Agent"] = opts.userAgent;

    type InitArgs = {
      mode: "fullscreen";
      url: string;
      playerId: string;
      componentTag: string;
      headers?: Record<string, string>;
      rate?: number;
      exitOnEnd?: boolean;
      loopOnEnd?: boolean;
      pipEnabled?: boolean;
      bkmodeEnabled?: boolean;
      showControls?: boolean;
      displayMode?: string;
      startAtSec?: number;
    };

    const args: InitArgs = {
      mode: "fullscreen",
      url: opts.url,
      playerId: PLAYER_ID,
      componentTag: "div",
      headers: Object.keys(headers).length ? headers : undefined,
      rate: 1,
      exitOnEnd: true,
      loopOnEnd: false,
      pipEnabled: true,
      bkmodeEnabled: true,
      showControls: true,
      displayMode: "all",
    };
    if (typeof opts.startAtSec === "number" && opts.startAtSec > 5) {
      args.startAtSec = opts.startAtSec;
    }

    const initFn = (mod as unknown as { initPlayer: (a: InitArgs) => Promise<unknown> }).initPlayer;
    const res = await initFn(args);
    const ok = (res as { result?: boolean })?.result !== false;
    if (!ok) return false;

    if (opts.onExit) {
      const cb = opts.onExit;
      const listenable = mod as unknown as {
        addListener: (
          ev: string,
          handler: (data: unknown) => void,
        ) => Promise<{ remove: () => void }> | { remove: () => void };
      };
      const h = await listenable.addListener("jeepCapVideoPlayerExit", (data: unknown) => {
        const pos = Number((data as { currentTime?: number })?.currentTime ?? 0);
        cb(Number.isFinite(pos) ? pos : 0);
      });
      exitHandle = h;
    }
    return true;
  } catch {
    return false;
  }
}

export async function stopNative(): Promise<void> {
  const mod = await loadPlugin();
  if (!mod) return;
  exitHandle?.remove();
  exitHandle = null;
  try { await mod.stopAllPlayers(); } catch { /* ignore */ }
}
