// D-pad / remote control navigation for Smart TVs (Tizen, WebOS, AndroidTV, FireTV)
// Handles arrow keys, Enter and Back. Uses spatial navigation: picks the nearest
// focusable in the pressed direction relative to the currently focused element.

let bound = false;

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[role='button']:not([disabled])",
  "[role='link']",
  "video[controls]",
].join(",");

function visibleFocusables(): HTMLElement[] {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return all.filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    return true;
  });
}

type Dir = "up" | "down" | "left" | "right";

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
    let secondary = 0;
    switch (dir) {
      case "up":    inDir = dy < -4; primary = -dy; secondary = Math.abs(dx); break;
      case "down":  inDir = dy >  4; primary =  dy; secondary = Math.abs(dx); break;
      case "left":  inDir = dx < -4; primary = -dx; secondary = Math.abs(dy); break;
      case "right": inDir = dx >  4; primary =  dx; secondary = Math.abs(dy); break;
    }
    if (!inDir) continue;
    // weight perpendicular distance heavier so we stay in the same row/column
    const score = primary + secondary * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function focusFirst() {
  const list = visibleFocusables();
  if (list.length) list[0].focus();
}

function handleKey(e: KeyboardEvent) {
  // Don't hijack typing inside inputs/textareas
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName;
  const typing =
    tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;

  const key = e.key;
  const code = (e as any).keyCode as number | undefined;

  // Smart TV remote keycodes (some platforms don't set e.key)
  const isUp     = key === "ArrowUp"    || code === 38;
  const isDown   = key === "ArrowDown"  || code === 40;
  const isLeft   = key === "ArrowLeft"  || code === 37;
  const isRight  = key === "ArrowRight" || code === 39;
  const isEnter  = key === "Enter"      || code === 13;
  const isBack   = key === "Backspace"  || code === 10009 /* Tizen */ || code === 461 /* WebOS */;

  if (typing && !isBack) return;

  if (isBack) {
    e.preventDefault();
    if (window.history.length > 1) window.history.back();
    return;
  }

  if (isEnter) {
    if (target && target !== document.body) {
      // let native click happen
      return;
    }
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
  const active = (document.activeElement as HTMLElement | null) ?? null;
  if (!active || active === document.body) {
    focusFirst();
    return;
  }
  const next = pickNearest(active, dir);
  if (next) {
    next.focus();
    next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

export function initTvDpad() {
  if (typeof window === "undefined" || bound) return;
  bound = true;
  window.addEventListener("keydown", handleKey, { capture: true });
  // First focus so the remote has something to start from
  setTimeout(() => {
    if (document.activeElement === document.body) focusFirst();
  }, 300);
}
