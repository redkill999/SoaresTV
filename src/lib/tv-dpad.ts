// Controle remoto / D-pad para Smart TVs (Tizen, WebOS, AndroidTV, FireTV)
// e também para teclado em desktop/laptop. Navegação espacial por setas,
// Enter para ativar, Back para voltar, e teclas de mídia (play/pause/stop).

let bound = false;
let lastInteractionWasKeyboard = false;
let routeCleanup: (() => void) | null = null;

// Anti-clique-fantasma do controle remoto / teclado:
// - Debounce: ignora Enters repetidos em < 300ms (botão OK com repeat).
// - Confirmação dupla: ativar um <Link> que abre o player exige 2 Enters
//   no mesmo item dentro de 2s. Evita abertura acidental do filme.
let lastEnterAt = 0;
let pendingActivation: { el: HTMLElement; at: number } | null = null;
const ENTER_DEBOUNCE_MS = 300;
const CONFIRM_WINDOW_MS = 2000;

function logDpad(reason: string, extra?: Record<string, unknown>) {
  try {
    console.log("[tv-dpad]", reason, extra ?? {});
  } catch { /* noop */ }
}

function isPlayerLink(el: HTMLElement | null): el is HTMLAnchorElement {
  if (!el || el.tagName !== "A") return false;
  const href = (el as HTMLAnchorElement).getAttribute("href") || "";
  return href.startsWith("/player/") || href.includes("/player/");
}

function showConfirmHint(el: HTMLElement) {
  // Marca visualmente o item como "armado". O visual real vem de CSS
  // (regra [data-tv-arming="1"] em styles.css) — usar classe/atributo
  // garante que a regra !important do foco TV não sobrescreva.
  el.setAttribute("data-tv-arming", "1");
  window.clearTimeout((el as HTMLElement & { __armT?: number }).__armT);
  (el as HTMLElement & { __armT?: number }).__armT = window.setTimeout(() => {
    el.removeAttribute("data-tv-arming");
  }, CONFIRM_WINDOW_MS) as unknown as number;
}

function clearConfirmHint(el: HTMLElement) {
  el.removeAttribute("data-tv-arming");
  window.clearTimeout((el as HTMLElement & { __armT?: number }).__armT);
}


const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[role='button']:not([disabled])",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='option']",
  "video[controls]",
  "summary",
].join(",");

function isVisible(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  if (r.bottom < 0 || r.top > window.innerHeight + 200) return false;
  if (r.right < 0 || r.left > window.innerWidth + 200) return false;
  // getComputedStyle é caro (força reflow) — evitamos aqui. Elementos com
  // display:none/visibility:hidden já retornam rect zerado no filtro acima.
  // pointer-events:none em focusable real é raríssimo; se ocorrer, aceita.
  return true;
}

/** Retorna o container "scope" mais próximo do elemento — usado para
 *  limitar a busca de focusables em grids gigantes (Filmes/Séries com
 *  milhares de tiles). Se nenhum ancestral marca [data-tv-scope], usa
 *  a rota atual (main/section) ou o document como fallback. */
function scopeFor(el: HTMLElement | null): ParentNode {
  if (!el) return document;
  const scoped = el.closest<HTMLElement>("[data-tv-scope]");
  if (scoped) return scoped;
  const main = document.querySelector("main");
  return main ?? document;
}

function visibleFocusables(root: ParentNode = document): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return all.filter(isVisible);
}


type Dir = "up" | "down" | "left" | "right";

/**
 * Navegação espacial: escolhe o focusable mais próximo na direção `dir`.
 * Prioriza candidatos que se sobrepõem perpendicularmente ao elemento atual,
 * mantendo o usuário na mesma linha/coluna visual.
 */
function pickNearest(current: HTMLElement, dir: Dir): HTMLElement | null {
  const cr = current.getBoundingClientRect();
  const cx = cr.left + cr.width / 2;
  const cy = cr.top + cr.height / 2;

  const scan = (candidates: HTMLElement[]): HTMLElement | null => {
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of candidates) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const dx = x - cx;
      const dy = y - cy;

      let inDir = false;
      let primary = 0;
      let perpDist = 0;
      let overlap = 0;

      switch (dir) {
        case "up":
          inDir = r.bottom <= cr.top + 4;
          primary = cr.top - r.bottom;
          perpDist = Math.abs(dx);
          overlap = Math.max(0, Math.min(cr.right, r.right) - Math.max(cr.left, r.left));
          break;
        case "down":
          inDir = r.top >= cr.bottom - 4;
          primary = r.top - cr.bottom;
          perpDist = Math.abs(dx);
          overlap = Math.max(0, Math.min(cr.right, r.right) - Math.max(cr.left, r.left));
          break;
        case "left":
          inDir = r.right <= cr.left + 4;
          primary = cr.left - r.right;
          perpDist = Math.abs(dy);
          overlap = Math.max(0, Math.min(cr.bottom, r.bottom) - Math.max(cr.top, r.top));
          break;
        case "right":
          inDir = r.left >= cr.right - 4;
          primary = r.left - cr.right;
          perpDist = Math.abs(dy);
          overlap = Math.max(0, Math.min(cr.bottom, r.bottom) - Math.max(cr.top, r.top));
          break;
      }

      if (!inDir) continue;
      const overlapBonus = overlap > 0 ? -1000 : 0;
      const score = Math.max(0, primary) + perpDist * 2 + overlapBonus;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  };

  // 1ª passada: apenas dentro do container [data-tv-scope] — grids gigantes
  // (Filmes/Séries com scroll infinito) não pagam getBoundingClientRect em
  // milhares de tiles a cada seta.
  const scope = scopeFor(current);
  const scopedBest = scan(visibleFocusables(scope));
  if (scopedBest) return scopedBest;
  // 2ª passada: se não achou nada no scope (borda do grid), procura no
  // documento inteiro para permitir sair para menu lateral, tabs, etc.
  if (scope !== document) return scan(visibleFocusables(document));
  return null;
}


function focusFirst(): boolean {
  // 1) Respeita um alvo explícito marcado pela página (ex.: tile principal da home)
  const preferred = document.querySelector<HTMLElement>("[data-tv-default-focus]");
  if (preferred && isVisible(preferred)) {
    preferred.focus({ preventScroll: false });
    return true;
  }
  const list = visibleFocusables();
  // Prefere o primeiro elemento visível "acima da dobra"
  const inView = list.find((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.top < window.innerHeight;
  });
  const target = inView ?? list[0];
  if (target) {
    target.focus({ preventScroll: false });
    return true;
  }
  return false;
}

function ensureFocus(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || !isVisible(active)) {
    focusFirst();
    return document.activeElement as HTMLElement | null;
  }
  return active;
}

function handleKey(e: KeyboardEvent) {
  const tvMode = document.documentElement.hasAttribute("data-tv-mode") || isSmartTvEnv();
  // Não interfere quando digitando em inputs/textarea/contenteditable
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  const isRangeInput = tag === "INPUT" && (target as HTMLInputElement | null)?.type === "range";
  const typing =
    (tag === "INPUT" && !isRangeInput) || tag === "TEXTAREA" || target?.isContentEditable;

  const key = e.key;
  const code = (e as KeyboardEvent & { keyCode?: number }).keyCode ?? 0;

  // Keycodes de remotos Smart TV (alguns não setam e.key).
  // Android TV / TCL / MiBox entregam os KEYCODE_* brutos do Android
  // via Capacitor WebView: 19/20/21/22 (D-pad), 23/66 (OK), 4 (Back).
  const isUp     = key === "ArrowUp"    || code === 38 || code === 19;
  const isDown   = key === "ArrowDown"  || code === 40 || code === 20;
  const isLeft   = key === "ArrowLeft"  || code === 37 || code === 21;
  const isRight  = key === "ArrowRight" || code === 39 || code === 22;
  // Space (32) NÃO é mapeado como OK fora de Smart TVs — quebra <select>, <details>, etc.
  const isEnter  = key === "Enter"      || code === 13 || code === 23 /* Android DPAD_CENTER */ ||
                   code === 66 /* Android ENTER */ || (code === 32 && isSmartTvEnv());
  const isBack   =
    key === "Backspace" || key === "GoBack" || key === "BrowserBack" ||
    code === 8 /* Backspace */ || code === 4 /* Android BACK */ ||
    code === 10009 /* Tizen Return */ || code === 461 /* WebOS Back */ ||
    code === 27 /* Esc */;

  // Teclas de mídia comuns em remotos
  const isMediaPlayPause = key === "MediaPlayPause" || code === 179 || code === 10252;
  const isMediaPlay = key === "MediaPlay" || code === 415;
  // ATENÇÃO: keyCode 19 é KEYCODE_DPAD_UP no Android — não confundir com
  // pausa. Só tratamos MediaPause via key === "MediaPause" (nunca por code cru).
  const isMediaPause = key === "MediaPause";

  const isMediaStop = key === "MediaStop" || code === 413;

  // Marca interação por teclado para o estilo de foco
  if (!lastInteractionWasKeyboard) {
    lastInteractionWasKeyboard = true;
    document.documentElement.classList.add("tv-focus");
  }

  // Teclas de mídia: aciona o controle nativo do <video> mais próximo/ativo
  if (isMediaPlayPause || isMediaPlay || isMediaPause || isMediaStop) {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (video) {
      e.preventDefault();
      if (isMediaStop) {
        try { video.pause(); video.currentTime = 0; } catch { /* noop */ }
      } else if (isMediaPlay) {
        void video.play().catch(() => undefined);
      } else if (isMediaPause) {
        try { video.pause(); } catch { /* noop */ }
      } else {
        // play/pause toggle
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
      }
      return;
    }
  }

  // Back funciona mesmo digitando
  if (isBack) {
    // Se há um <details open> ou modal, deixe o próximo handler tratar.
    // Caso contrário, volta na história.
    if (typing && tag === "INPUT") {
      // Em inputs, Backspace apaga texto — não intercepta.
      return;
    }
    const openDetails = document.querySelector("details[open]");
    if (openDetails) {
      e.preventDefault();
      openDetails.removeAttribute("open");
      return;
    }
    e.preventDefault();
    if (window.location.pathname.startsWith("/player/")) {
      window.dispatchEvent(new CustomEvent("soarestv:player-back"));
      return;
    }
    if (["/live", "/movies", "/series"].includes(window.location.pathname)) {
      window.history.pushState(null, "", "/home");
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    if (window.history.length > 1) window.history.back();
    return;
  }

  // Em modo TV, Up/Down PRECISAM funcionar mesmo com um <input> focado —
  // não existe Tab no controle remoto. Sem isto o usuário fica preso no
  // campo Servidor do login e todos os campos parecem "selecionados juntos".
  // Fora de tvMode (teclado desktop), typing continua bloqueando 100%.
  if (typing) {
    if (!tvMode) return;
    if (!isUp && !isDown) return; // Left/Right e digitação seguem normais no input
  }

  // No navegador desktop, deixa setas/scroll nativos funcionarem normalmente.
  // A navegação espacial por D-pad fica restrita ao APK/Smart TV.
  if (!tvMode) return;

  if (isEnter) {
    const now = Date.now();
    // Debounce: rejeita Enters muito próximos (botão OK com repeat / chave bouncing)
    if (now - lastEnterAt < ENTER_DEBOUNCE_MS) {
      e.preventDefault();
      logDpad("enter-debounced", { dt: now - lastEnterAt });
      return;
    }
    lastEnterAt = now;

    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) {
      const tagA = active.tagName;
      const role = active.getAttribute("role");
      const activatable =
        tagA === "A" || tagA === "BUTTON" || role === "button" ||
        role === "link" || role === "menuitem" || role === "tab" || role === "option";
      if (!activatable) { e.preventDefault(); return; }

      // Confirmação dupla SÓ para links que abrem o player (filme/episódio/canal).
      // Demais botões (categorias, navegação, settings) ativam normal no 1º Enter.
      if (isPlayerLink(active)) {
        const same = pendingActivation && pendingActivation.el === active &&
          (now - pendingActivation.at) < CONFIRM_WINDOW_MS;
        if (!same) {
          e.preventDefault();
          pendingActivation = { el: active, at: now };
          showConfirmHint(active);
          logDpad("enter-arm-player", { href: (active as HTMLAnchorElement).href });
          return;
        }
        // 2º Enter no mesmo item dentro da janela → confirma e abre player
        clearConfirmHint(active);
        pendingActivation = null;
        logDpad("enter-confirm-player", { href: (active as HTMLAnchorElement).href });
      } else {
        // Trocou de alvo → limpa qualquer confirmação pendente
        if (pendingActivation && pendingActivation.el !== active) {
          clearConfirmHint(pendingActivation.el);
          pendingActivation = null;
        }
        logDpad("enter-activate", { tag: tagA, role });
      }

      e.preventDefault();
      active.click();
      return;
    }
    e.preventDefault();
    focusFirst();
    return;
  }

  let dir: Dir | null = null;
  if (isUp) dir = "up";
  else if (isDown) dir = "down";
  else if (isLeft) dir = "left";
  else if (isRight) dir = "right";
  if (!dir) return;

  e.preventDefault();
  const active = ensureFocus();
  if (!active) return;

  const next = pickNearest(active, dir);
  if (next) {
    // Mover o foco com direcional cancela qualquer confirmação pendente
    if (pendingActivation) {
      clearConfirmHint(pendingActivation.el);
      pendingActivation = null;
    }
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function handleMouse() {
  if (lastInteractionWasKeyboard) {
    lastInteractionWasKeyboard = false;
    document.documentElement.classList.remove("tv-focus");
  }
}

export function initTvDpad() {
  if (typeof window === "undefined" || bound) return;
  bound = true;

  window.addEventListener("keydown", handleKey, { capture: true });
  window.addEventListener("mousedown", handleMouse, { capture: true });
  window.addEventListener("pointerdown", handleMouse, { capture: true });

  // Foco inicial — dá um alvo para o remoto começar
  setTimeout(() => {
    if (!document.activeElement || document.activeElement === document.body) {
      focusFirst();
    }
  }, 300);

  // Re-foco após troca de rota — sem polling: escutamos popstate e
  // monkey-patch único de pushState/replaceState (TanStack Router usa
  // history.pushState internamente).
  const onRouteChange = () => {
    // Limpa qualquer confirmação pendente do D-pad (link "armado" do player)
    if (pendingActivation) {
      clearConfirmHint(pendingActivation.el);
      pendingActivation = null;
    }
    setTimeout(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        // preventScroll: true — evita jogar a página pro topo se o
        // primeiro focusable estiver fora da dobra inicial.
        const preferred = document.querySelector<HTMLElement>("[data-tv-default-focus]");
        if (preferred && isVisible(preferred)) {
          preferred.focus({ preventScroll: true });
        } else {
          const list = visibleFocusables();
          const target = list.find((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.top < window.innerHeight;
          }) ?? list[0];
          target?.focus({ preventScroll: true });
        }
      }
    }, 200);
  };

  const w = window as Window & {
    __tvDpadHistoryPatched?: boolean;
    __tvDpadRouteEvent?: string;
  };
  const EVT = "soarestv:tv-route-change";
  w.__tvDpadRouteEvent = EVT;
  if (!w.__tvDpadHistoryPatched) {
    w.__tvDpadHistoryPatched = true;
    const fire = () => window.dispatchEvent(new Event(EVT));
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args: Parameters<typeof origPush>) {
      const r = origPush.apply(this, args);
      fire();
      return r;
    };
    history.replaceState = function (...args: Parameters<typeof origReplace>) {
      const r = origReplace.apply(this, args);
      fire();
      return r;
    };
  }
  window.addEventListener(EVT, onRouteChange);
  window.addEventListener("popstate", onRouteChange);
  routeCleanup = () => {
    window.removeEventListener(EVT, onRouteChange);
    window.removeEventListener("popstate", onRouteChange);
  };
}

/** Remove handlers do D-pad (útil para HMR/testes). */
export function destroyTvDpad() {
  if (typeof window === "undefined" || !bound) return;
  window.removeEventListener("keydown", handleKey, { capture: true } as EventListenerOptions);
  window.removeEventListener("mousedown", handleMouse, { capture: true } as EventListenerOptions);
  window.removeEventListener("pointerdown", handleMouse, { capture: true } as EventListenerOptions);
  if (routeCleanup) { routeCleanup(); routeCleanup = null; }
  bound = false;
}

/** Detecta se o ambiente parece ser Smart TV / TV Box. */
export function isSmartTvEnv(): boolean {
  if (typeof navigator === "undefined") return false;
  // Sinais de plataforma (globals do próprio SO da TV) — mais confiáveis
  // que UA em marcas "brancas" (AOC, Philips, TVs Android genéricas).
  const w = window as Window & {
    tizen?: unknown; webOS?: unknown; webOSSystem?: unknown;
    PalmSystem?: unknown; __tv?: boolean;
  };
  if (w.tizen || w.webOS || w.webOSSystem || w.PalmSystem || w.__tv === true) return true;
  const ua = navigator.userAgent || "";
  return /Smart[- ]?TV|SMART-TV|Tizen|Web0S|WebOS|PalmSystem|NetCast|GoogleTV|Google TV|AndroidTV|Android TV|Android[^;)]*;\s?(?:TV|ATV)|HbbTV|AppleTV|Apple TV|CrKey|NetTV|InetTV|Opera TV|SmartCast|Viera|NetRange|AFT[A-Z]|FireTV|Fire TV|BRAVIA|VIDAA|Hisense|Philips|PhilipsTV|AOC|DTV|Roku|TCL|MiBOX|MiTV|Chromecast|AOSP on IAT/i.test(ua);
}


/**
 * Detecta especificamente TV/TV Box (diferente de `data-tv-mode`, que também
 * cobre celular).
 *
 * IMPORTANTE — não voltar a usar heurística de "sem touch":
 * WebViews de Android TV frequentemente reportam `maxTouchPoints > 0` e/ou
 * `ontouchstart` mesmo sem tela touch, e navegadores desktop reportam
 * `maxTouchPoints === 0`. O fallback antigo (`noTouch`) causava:
 *   - TV real caindo no painel de celular (index.tsx → isTv=false)
 *   - Desktop browser caindo no modo TV (regressão do TV_MODE_SCRIPT)
 *
 * Sinais confiáveis (nesta ordem):
 *   1. `window.__deviceType === "tv"` — flag opcional injetada por um
 *      plugin nativo (Android UiModeManager.UI_MODE_TYPE_TELEVISION)
 *      antes da WebView carregar. Se existir, é a verdade.
 *   2. Regex de UA de Smart TV / TV Box (`isSmartTvEnv()`).
 * Nada de touch/no-touch.
 */
export function isTvDevice(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const injected = (window as Window & { __deviceType?: string }).__deviceType;
  if (injected === "tv") return true;
  if (injected === "phone" || injected === "tablet") return false;
  return isSmartTvEnv();
}
