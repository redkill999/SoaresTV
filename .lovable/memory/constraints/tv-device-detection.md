---
name: TV device detection (isTvDevice)
description: isTvDevice() em src/lib/tv-dpad.ts NÃO pode usar heurística de touch/no-touch. WebView de Android TV frequentemente reporta maxTouchPoints>0 e desktop reporta 0 — o fallback antigo mandava TV real pro painel de celular no login e desktop pro modo TV.
type: constraint
---
Em `src/lib/tv-dpad.ts`, `isTvDevice()` deve olhar SOMENTE:
1. `window.__deviceType === "tv"` (flag opcional injetada por plugin nativo)
2. `isSmartTvEnv()` (regex de UA de Smart TV/TV Box)

**NÃO** voltar a incluir:
```ts
const noTouch = (navigator.maxTouchPoints ?? 0) === 0 && !("ontouchstart" in window);
return noTouch;
```

**Why:** essa heurística já causou dois bugs opostos:
- TV Box Android com WebView reportando touch → `isTvDevice()=false` → login mostra painel gradiente de celular em vez do painel web/desktop com arte SoaresTV.
- Navegador desktop → `isTvDevice()=true` → mesmo problema descrito em `constraints/tv-mode-trigger.md` (scroll quebra, cursor:none, canvas 1280×720).

Se precisar distinguir TV nativa de celular nativo com mais confiança, exponha `window.__deviceType` via um plugin Capacitor pequeno que lê `UiModeManager.getCurrentModeType() === UI_MODE_TYPE_TELEVISION` antes da WebView subir. Nunca inferir por touch.

Dívida técnica relacionada: hoje há 4 implementações divergentes de "isNative"/"isTV" (xtream.ts, platform.ts, tv-dpad.ts, __root.tsx). Consolidar em uma única fonte quando houver tempo.
