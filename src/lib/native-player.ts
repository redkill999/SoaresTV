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

async function closeFullscreen(mod: CVPModule): Promise<void> {
  const player = mod as unknown as {
    exitPlayer?: () => Promise<unknown>;
    stopAllPlayers?: () => Promise<unknown>;
  };

  // IMPORTANTE: no Android, stopAllPlayers() apenas chama fsFragment.pause()
  // e NÃO remove o FrameLayout fullscreen. Para devolver a tela à WebView
  // precisamos chamar exitPlayer(), que dispara playerExit() e remove o overlay.
  try { await player.exitPlayer?.(); } catch { /* ignore */ }
  try { await player.stopAllPlayers?.(); } catch { /* ignore */ }
}


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
  debugHandles.forEach((h) => { try { h.remove(); } catch { /* ignore */ } });
  debugHandles = [];


  try {
    // Tenta encerrar player anterior se ainda estiver aberto. Usar exitPlayer
    // antes de stopAllPlayers evita deixar o overlay fullscreen preso por cima
    // da WebView quando um LIVE nunca sai do loading.
    await closeFullscreen(mod);

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

    const listenable = mod as unknown as {
      addListener: (
        ev: string,
        handler: (data: unknown) => void,
      ) => Promise<{ remove: () => void }> | { remove: () => void };
    };

    // Registra os listeners ANTES de abrir o fullscreen nativo. Em alguns APKs
    // o ExoPlayer emite ready/error durante o initPlayer; se registrarmos depois,
    // o debug visual nunca recebe o motivo da falha.
    if (opts.onEvent) {
      const evCb = opts.onEvent;
      const events = [
        "jeepCapVideoPlayerReady",
        "jeepCapVideoPlayerPlay",
        "jeepCapVideoPlayerPause",
        "jeepCapVideoPlayerEnded",
        "jeepCapVideoPlayerError",
      ];
      for (const ev of events) {
        try {
          const h = await listenable.addListener(ev, (data: unknown) => evCb(ev, data));
          debugHandles.push(h);
        } catch { /* ignore */ }
      }
    }

    const initFn = (mod as unknown as { initPlayer: (a: InitArgs) => Promise<unknown> }).initPlayer;
    let initSettled = false;
    const initTimeout = new Promise<false>((resolve) => {
      setTimeout(() => {
        if (initSettled) return;
        opts.onEvent?.("initPlayer:timeout", "initPlayer não respondeu em 8s; fechando overlay nativo");
        void closeFullscreen(mod);
        resolve(false);
      }, 8_000);
    });
    const res = await Promise.race([
      initFn(args).then((value) => {
        initSettled = true;
        return value;
      }).catch((err) => {
        initSettled = true;
        throw err;
      }),
      initTimeout,
    ]);
    if (res === false) return false;
    const ok = (res as { result?: boolean })?.result !== false;
    if (!ok) {
      opts.onEvent?.("initPlayer:false", res);
      await closeFullscreen(mod);
      return false;
    }

    if (opts.onExit) {
      const cb = opts.onExit;
      const h = await listenable.addListener("jeepCapVideoPlayerExit", (data: unknown) => {
        const pos = Number((data as { currentTime?: number })?.currentTime ?? 0);
        cb(Number.isFinite(pos) ? pos : 0);
      });
      exitHandle = h;
    }
    return true;
  } catch (err) {
    opts.onEvent?.("exception", String((err as Error)?.message ?? err));
    await closeFullscreen(mod);
    return false;
  }
}


export async function stopNative(): Promise<void> {
  const mod = await loadPlugin();
  if (!mod) return;
  exitHandle?.remove();
  exitHandle = null;
  await closeFullscreen(mod);
}
