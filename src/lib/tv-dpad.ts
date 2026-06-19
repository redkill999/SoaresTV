// Controle remoto / D-pad para Smart TVs (Tizen, WebOS, AndroidTV, FireTV)
// e também para teclado em desktop/laptop. Navegação espacial por setas,
// Enter para ativar, Back para voltar, e teclas de mídia (play/pause/stop).

let bound = false;
let lastInteractionWasKeyboard = false;

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
  const isEnter  = key === "Enter"      || code === 13 || code === 32 /* Space/OK em alguns remotos */;
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
    if (window.history.length > 1) window.history.back();
    return;
  }

  if (typing) return;

  if (isEnter) {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) {
      // Deixa o comportamento nativo (click/submit). Para <a>, garante click.
      if (active.tagName === "A" || active.getAttribute("role") === "link") {
        e.preventDefault();
        active.click();
      }
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
  setInterval(() => {
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

/** Detecta se o ambiente parece ser Smart TV / TV Box. */
export function isSmartTvEnv(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Tizen|Web0S|WebOS|SmartTV|SMART-TV|HbbTV|NetCast|VIDAA|AFT[A-Z]|AndroidTV|GoogleTV|BRAVIA|Hisense|Roku/i.test(ua);
}
