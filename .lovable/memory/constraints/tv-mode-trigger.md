---
name: TV mode trigger
description: TV mode (canvas 1280x720 escalado) só liga para APK nativo ou Smart TV via UA. Nunca reativar o gatilho "tela grande sem touch" — quebra o uso em navegador desktop (scrollbars somem, cursor: none, painel direito não rola).
type: constraint
---
TV mode em `src/routes/__root.tsx` (`TV_MODE_SCRIPT`) deve usar:
`var isTV = isNative || isSmartTV;`

**NÃO** voltar a incluir `(!isPhoneOrTablet && maxDim >= 1280 && minDim >= 720)` — isso liga TV mode em qualquer navegador desktop, escondendo scrollbars (`html[data-tv-mode] *::-webkit-scrollbar { display: none }`), aplicando `cursor: none` e travando body em 1280×720 escalado, o que quebra o scroll do painel direito em /live, /movies, /series.

**Why:** no celular (sem TV mode) tudo funciona perfeito; no navegador desktop o usuário quer a mesma experiência responsiva, não o canvas de TV.
