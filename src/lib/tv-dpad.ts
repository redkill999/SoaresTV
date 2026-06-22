// Controle remoto / D-pad para Smart TVs (Tizen, WebOS, AndroidTV, FireTV)
// e também para teclado em desktop/laptop. Navegação espacial por setas,
// Enter para ativar, Back para voltar, e teclas de mídia (play/pause/stop).

let bound = false;
let lastInteractionWasKeyboard = false;
let routeWatchId: ReturnType<typeof setInterval> | null = null;

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
  // Marca visualmente o item como "armado" para confirmação.
  el.setAttribute("data-tv-arming", "1");
  el.style.outline = "3px solid #1FB6FF";
  el.style.outlineOffset = "2px";
  window.clearTimeout((el as HTMLElement & { __armT?: number }).__armT);
  (el as HTMLElement & { __armT?: number }).__armT = window.setTimeout(() => {
    el.removeAttribute("data-tv-arming");
    el.style.outline = "";
    el.style.outlineOffset = "";
  }, CONFIRM_WINDOW_MS) as unknown as number;
}

function clearConfirmHint(el: HTMLElement) {
  el.removeAttribute("data-tv-arming");
  el.style.outline = "";
  el.style.outlineOffset = "";
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
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (style.pointerEvents === "none") return false;
  return true;
}

function visibleFocusables(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
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

  let best: HTMLElement | null = null;
  let bestScore = Infinity;

  for (const el of visibleFocusables()) {
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

    // Score: distância na direção + penalidade perpendicular, com bônus
    // grande para sobreposição (mantém na mesma linha/coluna).
    const overlapBonus = overlap > 0 ? -1000 : 0;
    const score = Math.max(0, primary) + perpDist * 2 + overlapBonus;

    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
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
  const typing =
    tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;

  const key = e.key;
  const code = (e as KeyboardEvent & { keyCode?: number }).keyCode ?? 0;

  // Keycodes de remotos Smart TV (alguns não setam e.key)
  const isUp     = key === "ArrowUp"    || code === 38;
  const isDown   = key === "ArrowDown"  || code === 40;
  const isLeft   = key === "ArrowLeft"  || code === 37;
  const isRight  = key === "ArrowRight" || code === 39;
  // Space (32) NÃO é mapeado como OK fora de Smart TVs — quebra <select>, <details>, etc.
  const isEnter  = key === "Enter"      || code === 13 || (code === 32 && isSmartTvEnv());
  const isBack   =
    key === "Backspace" || key === "GoBack" || key === "BrowserBack" ||
    code === 8 /* Backspace */ || code === 10009 /* Tizen Return */ ||
    code === 461 /* WebOS Back */ || code === 27 /* Esc */;

  // Teclas de mídia comuns em remotos
  const isMediaPlayPause = key === "MediaPlayPause" || code === 179 || code === 10252;
  const isMediaPlay = key === "MediaPlay" || code === 415;
  const isMediaPause = key === "MediaPause" || code === 19;
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

  if (typing) return;

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

  // Re-foco após troca de rota (quando a página nova não tem foco)
  let lastPath = window.location.pathname;
  if (routeWatchId) clearInterval(routeWatchId);
  routeWatchId = setInterval(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) {
          focusFirst();
        }
      }, 200);
    }
  }, 250);
}

/** Remove handlers do D-pad (útil para HMR/testes). */
export function destroyTvDpad() {
  if (typeof window === "undefined" || !bound) return;
  window.removeEventListener("keydown", handleKey, { capture: true } as EventListenerOptions);
  window.removeEventListener("mousedown", handleMouse, { capture: true } as EventListenerOptions);
  window.removeEventListener("pointerdown", handleMouse, { capture: true } as EventListenerOptions);
  if (routeWatchId) { clearInterval(routeWatchId); routeWatchId = null; }
  bound = false;
}

/** Detecta se o ambiente parece ser Smart TV / TV Box. */
export function isSmartTvEnv(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Tizen|Web0S|WebOS|SmartTV|SMART-TV|HbbTV|NetCast|VIDAA|AFT[A-Z]|AndroidTV|Android TV|GoogleTV|BRAVIA|Hisense|Roku|TCL|MiBOX|MiTV|Chromecast|CrKey|AOSP on IAT|Linux;\s?Android[^)]*;\s?(?:TV|ATV|MiBOX|TCL)/i.test(ua);
}
