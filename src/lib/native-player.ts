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
  /** Stream ao vivo — muda defaults do initPlayer (sem PIP, sem exitOnEnd). */
  isLive?: boolean;
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
let hasActivePlayer = false;

// ---------------------------------------------------------------------------
// FIX A: closeFullscreen com timeout individual por chamada.
// No Android, exitPlayer() pode travar indefinidamente quando o ExoPlayer
// está em estado "loading" (buffer não chegou, codec preso). Sem timeout,
// stopNative() bloqueia a Promise e a WebView nunca recupera o foco.
// Cada método recebe 3 s; se não responder, continuamos sem erro.
// ---------------------------------------------------------------------------
function raceTimeout<T>(p: Promise<T> | undefined, ms: number): Promise<T | undefined> {
  if (!p) return Promise.resolve(undefined);
  return Promise.race([
    p,
    new Promise<undefined>((resolve) => setTimeout(resolve, ms)),
  ]);
}

// FIX A + retry: tenta fechar o overlay até 3 vezes com pausa de 1 s entre
// tentativas. Garante que o FrameLayout nativo seja removido mesmo se a
// primeira chamada de exitPlayer() falhar silenciosamente.
async function closeFullscreen(mod: CVPModule, opts?: { attempts?: number; exitTimeoutMs?: number; stopTimeoutMs?: number; retryDelayMs?: number }): Promise<void> {
  const player = mod as unknown as {
    exitPlayer?: () => Promise<unknown>;
    stopAllPlayers?: () => Promise<unknown>;
  };

  // IMPORTANTE: no Android, stopAllPlayers() apenas chama fsFragment.pause()
  // e NÃO remove o FrameLayout fullscreen. Para devolver a tela à WebView
  // precisamos chamar exitPlayer(), que dispara playerExit() e remove o overlay.
  const MAX_ATTEMPTS = opts?.attempts ?? 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try { await raceTimeout(player.exitPlayer?.(), opts?.exitTimeoutMs ?? 3_000); } catch { /* ignore */ }
    try { await raceTimeout(player.stopAllPlayers?.(), opts?.stopTimeoutMs ?? 2_000); } catch { /* ignore */ }
    // Após a primeira tentativa, aguarda 1 s antes de insistir. Se o evento
    // "jeepCapVideoPlayerExit" já foi disparado pelo plugin, não precisamos
    // tentar de novo — mas não temos como saber, então tentamos 3x.
    if (attempt < MAX_ATTEMPTS) {
      await new Promise<void>((r) => setTimeout(r, opts?.retryDelayMs ?? 1_000));
    }
  }
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
  // FIX C: limpar debugHandles também aqui (eram limpos somente no início,
  // mas stopNative() precisava fazê-lo também para evitar callbacks órfãos).
  debugHandles.forEach((h) => { try { h.remove(); } catch { /* ignore */ } });
  debugHandles = [];


  try {
    // Não faça limpeza pesada antes de TODO play: exitPlayer/stopAllPlayers
    // podem levar vários segundos no Android mesmo quando não há overlay aberto,
    // o que atrasava filmes/séries no APK. Só executa uma limpeza curta quando
    // sabemos que existe um player nativo ativo nesta sessão.
    if (hasActivePlayer) {
      await closeFullscreen(mod, { attempts: 1, exitTimeoutMs: 700, stopTimeoutMs: 500, retryDelayMs: 0 });
      hasActivePlayer = false;
    }

    // FIX D (alinhamento da barra de controles): trava landscape ANTES do
    // initPlayer. Sem isso, a Activity reconfigura dimensões logo após o
    // PlayerView ser desenhado e o overlay nativo dos controles fica
    // deslocado até o primeiro toque (bug conhecido do capacitor-video-player).
    try {
      const { ScreenOrientation } = await import("@capacitor/screen-orientation");
      await ScreenOrientation.lock({ orientation: "landscape" });
      // Frame extra para o WindowManager terminar o relayout antes do initPlayer.
      await new Promise<void>((r) => setTimeout(r, 80));
    } catch { /* não-native ou plugin ausente: segue normal */ }

    // REVERT: mais cedo hoje o APK reproduzia LIVE liso apenas com User-Agent.
    // Ao acrescentar Icy-MetaData/Accept-Encoding/Connection alguns provedores
    // passaram a devolver 400/403 no ExoPlayer. Voltando ao header mínimo.
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

    // REVERT: exitOnEnd/pipEnabled/bkmodeEnabled voltam aos valores originais
    // (que estavam funcionando em LIVE). O parâmetro opts.isLive permanece na
    // API para futuras diferenciações, mas hoje não altera o initPlayer.
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
    //
    // FIX B: "jeepCapVideoPlayerExit" agora é registrado ANTES do initPlayer.
    // Antes era registrado depois (lines 169-176 do arquivo original), então se
    // o usuário pressionasse Voltar enquanto o ExoPlayer ainda carregava, o
    // evento era perdido e o componente ficava em playerMode="native" para sempre.
    const evCb = opts.onEvent;
    const events = [
      "jeepCapVideoPlayerReady",
      "jeepCapVideoPlayerPlay",
      "jeepCapVideoPlayerPause",
      "jeepCapVideoPlayerEnded",
      "jeepCapVideoPlayerError",
      // FIX B: exit registrado pré-initPlayer para não perder Back durante loading
      "jeepCapVideoPlayerExit",
    ];
    await Promise.all(events.map(async (ev) => {
      try {
        const h = await listenable.addListener(ev, (data: unknown) => {
          if (ev === "jeepCapVideoPlayerExit" && opts.onExit) {
            const pos = Number((data as { currentTime?: number })?.currentTime ?? 0);
            opts.onExit(Number.isFinite(pos) ? pos : 0);
          }
          if (ev === "jeepCapVideoPlayerExit" || ev === "jeepCapVideoPlayerEnded") {
            hasActivePlayer = false;
          }
          // FIX D: ao receber Ready, reaplicar displayMode após pequeno delay
          // força o plugin a redesenhar os controles nativos com as dimensões
          // finais já estabilizadas — corrige a barra de progresso deslocada
          // que aparecia no primeiro toque.
          if (ev === "jeepCapVideoPlayerReady") {
            setTimeout(() => {
              try {
                const m = mod as unknown as {
                  setDisplayMode?: (a: { mode: string; playerId: string }) => unknown;
                };
                m.setDisplayMode?.({ mode: "all", playerId: PLAYER_ID });
              } catch { /* método pode não existir nesta versão do plugin */ }
            }, 200);
          }
          evCb?.(ev, data);
        });
        debugHandles.push(h);
      } catch { /* ignore */ }
    }));

    const initFn = (mod as unknown as { initPlayer: (a: InitArgs) => Promise<unknown> }).initPlayer;
    let initSettled = false;
    const initTimeout = new Promise<false>((resolve) => {
      setTimeout(() => {
        if (initSettled) return;
        opts.onEvent?.("initPlayer:timeout", "initPlayer não respondeu em 15s; fechando overlay nativo");
        void closeFullscreen(mod);
        resolve(false);
      }, 15_000);
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

    // FIX B: o listener de Exit já foi registrado acima no loop pre-initPlayer.
    // Registramos aqui apenas para compatibilidade se onExit vier como callback
    // separado (caso raro — a maioria já é tratada no loop acima).
    // Não registramos duplicata se já existe handle para "jeepCapVideoPlayerExit".
    if (opts.onExit && !debugHandles.some(() => false /* placeholder */)) {
      // Já coberto pelo loop acima — nada a fazer.
    }

    hasActivePlayer = true;
    return true;
  } catch (err) {
    opts.onEvent?.("exception", String((err as Error)?.message ?? err));
    await closeFullscreen(mod);
    hasActivePlayer = false;
    return false;
  }
}


// FIX C: stopNative agora remove debugHandles para evitar que callbacks de
// eventos antigos disparem sobre instâncias React já desmontadas.
export async function stopNative(): Promise<void> {
  const mod = await loadPlugin();
  exitHandle?.remove();
  exitHandle = null;
  // Remove todos os listeners de debug antes de fechar o overlay para que
  // eventos "exit" disparados pelo closeFullscreen não cheguem a callbacks mortos.
  debugHandles.forEach((h) => { try { h.remove(); } catch { /* ignore */ } });
  debugHandles = [];
  if (!mod) return;
  await closeFullscreen(mod);
  hasActivePlayer = false;
}

// Lê o currentTime do ExoPlayer nativo (overlay fullscreen). Usado pelo
// watchdog de stall do LIVE em VideoPlayer.tsx. Retorna null se plugin
// indisponível ou se a chamada falhar/timeoutar.
export async function getNativeCurrentTime(): Promise<number | null> {
  const mod = await loadPlugin();
  if (!mod) return null;
  try {
    const player = mod as unknown as {
      getCurrentTime?: (a: { playerId: string }) => Promise<{ value?: number } | undefined>;
    };
    const res = await raceTimeout(player.getCurrentTime?.({ playerId: PLAYER_ID }), 2_000);
    const v = Number((res as { value?: number } | undefined)?.value);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
