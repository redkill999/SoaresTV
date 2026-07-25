---
name: Virtualize live/movies/series grids (future)
description: Trocar grid comum por VirtualMediaGrid nas três abas — requer QA de scroll/foco/TV
type: feature
---
# Melhoria futura: virtualização dos grids XCIPTV

## Contexto
`src/components/VirtualMediaGrid.tsx` já existe e implementa `useWindowVirtualizer` corretamente, mas não é usado em nenhuma rota. As telas reais (`/live`, `/movies`, `/series`) usam grid comum + `useProgressive` (chunks de 240 itens que só crescem, nunca desmontam). Em contas com catálogos grandes (3–10k+ itens) isso mantém milhares de `<img>`/nós DOM montados permanentemente.

## Ganho esperado
DOM limitado a ~40–60 nós visíveis independente do tamanho do catálogo — reduz memória e melhora FPS de scroll, especialmente em Android TV/WebView.

## Por que NÃO foi aplicado ainda
Alteração toca simultaneamente: scroll do painel direito XCIPTV, navegação por controle remoto, foco (TV/APK), sentinelas de `useProgressive`, `data-tv-scope`. Fere a regra "não bagunçar o layout das três abas" sem QA dedicado em TV.

## Antes de aplicar
1. QA visual em desktop, mobile e TV/APK.
2. Confirmar que foco por controle remoto continua funcionando.
3. Confirmar que scroll do painel direito não regride (ver `mem://core` sobre `flex-1 min-h-0`).
4. Remover/combinar sentinelas de `useProgressive` no arquivo migrado.
