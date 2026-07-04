---
name: TV mode trigger
description: TV mode (canvas 1280x720 escalado em __root.tsx) só liga quando window.__deviceType==='tv' OU (não injetado E UA de Smart TV). Nunca mais `isNative || isSmartTV` — isso ativa TV mode em APK celular e faz o layout aparecer comprimido em 1280×720.
type: constraint
---
TV mode em `src/routes/__root.tsx` (`TV_MODE_SCRIPT`) deve usar:

```js
var injectedType = window.__deviceType;
var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
var isTV = injectedType === "tv" || (injectedType == null && isSmartTV);
```

**NÃO** voltar a incluir:
- `var isTV = isNative || isSmartTV;` — trata todo APK como TV, comprime celular em 1280×720.
- `(!isPhoneOrTablet && maxDim >= 1280 && minDim >= 720)` — liga TV mode em desktop, esconde scrollbars, aplica `cursor:none`.

`window.__deviceType` é injetado por `android-template/MainActivity.java` via `webView.evaluateJavascript` no `onCreate`, lendo:
- `UiModeManager.getCurrentModeType() === UI_MODE_TYPE_TELEVISION` → `"tv"`
- senão `smallestScreenWidthDp >= 600` → `"tablet"`
- senão → `"phone"`

**Why:** APK celular estava recebendo `isNative=true` e caindo em TV mode, mostrando layout comprimido de 1280×720 em vez do layout responsivo mobile. Agora só `"tv"` liga TV mode; `"phone"` e `"tablet"` mantêm viewport responsivo.

Também mantém invariantes antigas:
- Desktop web (sem `__deviceType`, sem UA de Smart TV) → sem TV mode. Scroll do painel direito em /live, /movies, /series funciona.
- Smart TV real (Tizen/WebOS/AndroidTV via UA) → TV mode ativa mesmo sem `__deviceType`.
